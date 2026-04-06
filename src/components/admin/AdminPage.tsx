import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
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
  HomeIcon,
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
import FirmTypesManager from './FirmTypesManager';
import FirmsManager from './FirmsManager';
import FirmContactsManager from './FirmContactsManager';
import ChannelsManager from './ChannelsManager';
import LanguagesManager from './LanguagesManager';
import HolidaysManager from './HolidaysManager';
import LeadTagsManager from './LeadTagsManager';
import FlagTypesManager from './FlagTypesManager';
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
import { supabase, isExpectedNoSessionError } from '../../lib/supabase';

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
    subcategories: ['Currencies', 'Currency rates'],
    requiresAdmin: true,
  },
  {
    label: 'Authentication',
    icon: ShieldCheckIcon,
    subcategories: ['Users'],
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
    subcategories: ['Contacts', 'Leads'],
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
      'Bonus formulas',
      'Contract templates',
      'Countries',
      'Email Templates',
      'Email Templates Placement',
      'Flag Types',
      'Holidays',
      'Languages',
      'Lead Stage Reasons',
      'Lead Sources',
      'Lead Tags',
      'Main Categories',
      'Public messages',
      'sub categories',
      'whatsapp template olds',
    ],
    requiresAdmin: false, // Everyone can access Misc
  },
  {
    label: 'Tenants',
    icon: BuildingOffice2Icon,
    subcategories: [
      'Bank accounts',
      'Departements',
      'Employees',
      'Employee Field Assignments',
      'Firm types',
      'Firms',
      'Firm contacts',
      'Channels',
      'Meeting Locations',
    ],
    requiresAdmin: true,
  },
  {
    label: 'Whatsapp',
    icon: ChatBubbleLeftRightIcon,
    subcategories: ['Whatsapp numbers', 'Whats app templates'],
    requiresAdmin: true,
  },
];

/** Subcategory labels hidden from sidebar/search (still in ADMIN_TABS for deep links if needed). */
const HIDDEN_ADMIN_SUBCATEGORY_LABELS = new Set([
  'Anchors',
  'Groups',
  'Vats',
  'Money accounts',
]);

/** Same name exclusions as SalesContributionPage (EmployeePerformance alignment). */
const DASHBOARD_EXCLUDED_EMPLOYEE_NAMES = new Set([
  'FINANCE',
  'INTERNS',
  'NO SCHEDULER',
  'Mango Test',
  'pink',
  'Interns',
]);

/** Department roles counted from `employee_field_assignments` (Sales contribution alignment). */
const DASHBOARD_ASSIGNMENT_ROLES = ['Sales', 'Handlers', 'Marketing', 'Finance'] as const;

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

interface AdminDashboardStats {
  totalActiveEmployees: number;
  sales: number;
  handlers: number;
  marketing: number;
  finance: number;
  administration: number;
  activeClientMeetingsToday: number;
  staffMeetingsToday: number;
  potentialClientMeetingsToday: number;
}

type AdminTopLink = { label: string; tabIndex: number; subIndex: number };

const titleCaseField = (value: string) =>
  value
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** Build merged user-change rows from `user_changes_history` (same shaping as former admin dashboard). */
const buildUserChangeRowsFromHistory = (
  userHistory: Array<{
    id: string | number;
    user_id?: string | number | null;
    changed_by?: string | number | null;
    field_name?: string | null;
    old_value?: unknown;
    new_value?: unknown;
    changed_at?: string | null;
  }>,
  getUserDisplayName: (userId?: string | number | null) => string
): RecentChange[] => {
  const historyByChange = new Map<
    string,
    {
      user_id: string | null;
      changed_by: string | null;
      changed_at: string | null;
      fields: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
    }
  >();
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
      field: entry.field_name || '',
      oldValue: entry.field_name === 'password' ? '•••••' : entry.old_value,
      newValue: entry.field_name === 'password' ? '•••••' : entry.new_value,
    });
  });

  return Array.from(historyByChange.values()).map(entry => {
    const infoParts = entry.fields.map(({ field, oldValue, newValue }) => {
      const t = titleCaseField(field || '');
      const displayOld = oldValue === null || oldValue === undefined || oldValue === '' ? 'Empty' : oldValue;
      const displayNew = newValue === null || newValue === undefined || newValue === '' ? 'Empty' : newValue;
      return `${t}: ${displayOld} → ${displayNew}`;
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
};

const AdminPage: React.FC = () => {
  const { isAdmin, isLoading, refreshAdminStatus } = useAdminRole();
  const navigate = useNavigate();
  const [openTab, setOpenTab] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ tab: number | null; sub: number | null }>({ tab: null, sub: null });

  // State for current user
  const [currentUser, setCurrentUser] = useState<{ first_name?: string; email?: string } | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [isSuperUser, setIsSuperUser] = useState<boolean>(false);
  const [isTopSectionCollapsed, setIsTopSectionCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [currentUserPhotoUrl, setCurrentUserPhotoUrl] = useState<string | null>(null);
  const [employeeData, setEmployeeData] = useState<{
    department?: string;
    bonusRole?: string;
  } | null>(null);

  const [dashboardStats, setDashboardStats] = useState<AdminDashboardStats | null>(null);
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(false);
  const [fullUserChanges, setFullUserChanges] = useState<RecentChange[]>([]);
  const [fullUserChangesLoading, setFullUserChangesLoading] = useState(false);

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

  const filteredAdminTabs = useMemo(() => {
    return ADMIN_TABS.filter(tab => !tab.requiresAdmin || isAdmin);
  }, [isAdmin]);

  const activeTopTabIndex = useMemo(() => {
    if (selected.tab != null) return selected.tab;
    if (openTab != null) return openTab;
    return 0;
  }, [selected.tab, openTab]);

  const topLinks = useMemo<AdminTopLink[]>(() => {
    const tab = filteredAdminTabs[activeTopTabIndex];
    if (!tab) return [];
    return tab.subcategories
      .map((label, subIndex) => ({ label, tabIndex: activeTopTabIndex, subIndex }))
      .filter((x) => !HIDDEN_ADMIN_SUBCATEGORY_LABELS.has(x.label));
  }, [filteredAdminTabs, activeTopTabIndex]);

  const sidebarItems = useMemo(() => {
    const filteredTabs = ADMIN_TABS.filter(tab => !tab.requiresAdmin || isAdmin);
    return filteredTabs.flatMap((tab, tabIndex) =>
      tab.subcategories
        .map((subLabel, subIndex) => ({
          key: `${tab.label}-${subLabel}`,
          subLabel,
          icon: tab.icon,
          tabIndex,
          subIndex,
        }))
        .filter(item => !HIDDEN_ADMIN_SUBCATEGORY_LABELS.has(item.subLabel))
    );
  }, [isAdmin]);

  const handleSearchSelect = (section: AdminSectionOption) => {
    setSelected({ tab: section.tabIndex, sub: section.subIndex });
    setOpenTab(section.tabIndex);
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

  // Outside click handler to close search results
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isSearchFocused && searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSearchFocused]);

  // Function to fetch current user data
  const fetchCurrentUser = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError) {
        if (!isExpectedNoSessionError(authError)) {
          console.error('Error getting auth user:', authError);
        }
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
            photo_url,
            photo,
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
              photo_url,
              photo,
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
          setCurrentUserPhotoUrl(empData.photo_url || empData.photo || null);
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

  const fetchDashboardEmployeeStats = async () => {
    setDashboardStatsLoading(true);
    try {
      const { data: allEmployeesData, error: allEmployeesDataError } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          email,
          employee_id,
          is_active,
          is_staff,
          tenants_employee!employee_id(
            id,
            display_name,
            department_id,
            tenant_departement!department_id(
              id,
              name
            )
          )
        `)
        .not('employee_id', 'is', null)
        .eq('is_active', true)
        .eq('is_staff', true);

      if (allEmployeesDataError) throw allEmployeesDataError;

      const processedEmployees = (allEmployeesData || [])
        .filter(user => user.tenants_employee && user.email)
        .map(user => {
          const employee = user.tenants_employee as unknown as {
            id: number;
            display_name?: string;
            department_id?: number | null;
            tenant_departement?: { id?: number; name?: string } | { id?: number; name?: string }[];
          };
          const dept = Array.isArray(employee.tenant_departement)
            ? employee.tenant_departement[0]
            : employee.tenant_departement;
          return {
            id: Number(employee.id),
            display_name: employee.display_name || '',
            department: dept?.name || 'Unknown',
          };
        });

      const uniqueEmployeesMap = new Map<number, { id: number; display_name: string; department: string }>();
      processedEmployees.forEach(emp => {
        if (!uniqueEmployeesMap.has(emp.id)) {
          uniqueEmployeesMap.set(emp.id, emp);
        }
      });
      const allEmployees = Array.from(uniqueEmployeesMap.values());
      const filteredEmployees = allEmployees.filter(
        emp => !DASHBOARD_EXCLUDED_EMPLOYEE_NAMES.has(emp.display_name)
      );

      const { data: roleAssignments, error: roleAssignmentsError } = await supabase
        .from('employee_field_assignments')
        .select('employee_id, department_role')
        .in('department_role', [...DASHBOARD_ASSIGNMENT_ROLES])
        .eq('is_active', true);

      if (roleAssignmentsError) throw roleAssignmentsError;

      const employeeIdsByRole = new Map<string, Set<number>>();
      DASHBOARD_ASSIGNMENT_ROLES.forEach(name => employeeIdsByRole.set(name, new Set()));
      (roleAssignments || []).forEach((row: { employee_id?: number | string; department_role?: string }) => {
        const role = row.department_role;
        const empId = Number(row.employee_id);
        if (role && !Number.isNaN(empId) && employeeIdsByRole.has(role)) {
          employeeIdsByRole.get(role)!.add(empId);
        }
      });

      // Today meeting stats
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const todayStart = new Date(today);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today);
      todayEnd.setHours(23, 59, 59, 999);

      const [activeClientMeetingsRes, potentialClientMeetingsRes, staffMeetingsRes] = await Promise.all([
        supabase
          .from('meetings')
          .select('id', { count: 'exact', head: true })
          .eq('meeting_date', todayStr)
          .or('calendar_type.eq.active_client,calendar_type.is.null')
          .or('status.is.null,status.neq.canceled,status.neq.cancelled'),
        supabase
          .from('meetings')
          .select('id', { count: 'exact', head: true })
          .eq('meeting_date', todayStr)
          .eq('calendar_type', 'potential_client')
          .or('status.is.null,status.neq.canceled,status.neq.cancelled'),
        supabase
          .from('outlook_teams_meetings')
          .select('id', { count: 'exact', head: true })
          .gte('start_date_time', todayStart.toISOString())
          .lte('start_date_time', todayEnd.toISOString())
          .or('status.is.null,status.neq.cancelled'),
      ]);

      if (activeClientMeetingsRes.error) console.error('Dashboard active client meetings count:', activeClientMeetingsRes.error);
      if (potentialClientMeetingsRes.error) console.error('Dashboard potential client meetings count:', potentialClientMeetingsRes.error);
      if (staffMeetingsRes.error) console.error('Dashboard staff meetings count:', staffMeetingsRes.error);

      setDashboardStats({
        totalActiveEmployees: filteredEmployees.length,
        sales: filteredEmployees.filter(emp => employeeIdsByRole.get('Sales')?.has(emp.id)).length,
        handlers: filteredEmployees.filter(emp => employeeIdsByRole.get('Handlers')?.has(emp.id)).length,
        marketing: filteredEmployees.filter(emp => employeeIdsByRole.get('Marketing')?.has(emp.id)).length,
        finance: filteredEmployees.filter(emp => employeeIdsByRole.get('Finance')?.has(emp.id)).length,
        administration: filteredEmployees.filter(
          emp => (emp.department || '').trim().toLowerCase() === 'administration'
        ).length,
        activeClientMeetingsToday: activeClientMeetingsRes.count || 0,
        staffMeetingsToday: staffMeetingsRes.count || 0,
        potentialClientMeetingsToday: potentialClientMeetingsRes.count || 0,
      });
    } catch (e) {
      console.error('Admin dashboard employee stats:', e);
      setDashboardStats({
        totalActiveEmployees: 0,
        sales: 0,
        handlers: 0,
        marketing: 0,
        finance: 0,
        administration: 0,
        activeClientMeetingsToday: 0,
        staffMeetingsToday: 0,
        potentialClientMeetingsToday: 0,
      });
    } finally {
      setDashboardStatsLoading(false);
    }
  };

  const loadFullUserChanges = async () => {
    setFullUserChangesLoading(true);
    try {
      const { data: userHistory, error: historyError } = await supabase
        .from('user_changes_history')
        .select('id, user_id, changed_by, field_name, old_value, new_value, changed_at')
        .order('changed_at', { ascending: false })
        .limit(500);

      if (historyError) throw historyError;

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
              last_name: (record as { last_name?: string }).last_name,
              email: record.email,
            });
          });
        }
      }

      const getUserDisplayName = (userId?: string | number | null) => {
        if (!userId) return 'System';
        const entry = userLookup.get(String(userId));
        if (!entry) return 'Unknown user';
        return (
          entry.full_name ||
          [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim() ||
          entry.email ||
          'Unknown user'
        );
      };

      const rows = buildUserChangeRowsFromHistory(userHistory || [], getUserDisplayName).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setFullUserChanges(rows);
    } catch (error) {
      console.error('Error loading user changes:', error);
      setFullUserChanges([]);
    } finally {
      setFullUserChangesLoading(false);
    }
  };

  // Fetch current user data on component mount
  useEffect(() => {
    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (!userLoading && isSuperUser) {
      void fetchDashboardEmployeeStats();
    }
  }, [userLoading, isSuperUser]);

  useEffect(() => {
    if (!userLoading && isSuperUser && fullUserChanges.length === 0 && !fullUserChangesLoading) {
      void loadFullUserChanges();
    }
  }, [userLoading, isSuperUser, fullUserChanges.length, fullUserChangesLoading]);

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
    <div className="admin-page-shell flex h-screen bg-[#ececec] w-full overflow-hidden">
      {/* Fixed Desktop Sidebar */}
      <aside
        className={`hidden md:flex fixed left-4 top-24 bottom-6 z-40 ${isSidebarHovered ? 'w-64' : 'w-20'} bg-white/95 border border-gray-200 rounded-[2rem] shadow-[0_18px_45px_rgba(15,23,42,0.18),0_6px_18px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.75)] flex-col transition-all duration-300 overflow-hidden`}
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => setIsSidebarHovered(false)}
      >
        <div className="border-b border-gray-200 px-4 py-4 min-h-[72px] flex items-center">
          <h2 className={`text-lg font-semibold text-gray-900 transition-opacity duration-200 ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>Admin</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          <button
            onClick={() => {
              setSelected({ tab: null, sub: null });
              setOpenTab(null);
              setIsTopSectionCollapsed(false);
              setSearchQuery('');
              setIsSearchFocused(false);
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left transition-all ${
              selected.tab === null && selected.sub === null
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-gray-100 text-gray-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <HomeIcon className="h-5 w-5 shrink-0" />
              <span className={`text-sm font-semibold whitespace-nowrap transition-opacity duration-200 ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>Dashboard</span>
            </div>
          </button>
          {ADMIN_TABS
            .filter(tab => !tab.requiresAdmin || isAdmin)
            .map((tab, tabIndex) => {
              const visibleSubcategories = tab.subcategories.filter(
                (subLabel) => !HIDDEN_ADMIN_SUBCATEGORY_LABELS.has(subLabel)
              );
              if (visibleSubcategories.length === 0) return null;
              const isOpen = openTab === tabIndex;
              const Icon = tab.icon;

              return (
                <div key={tab.label} className="space-y-1">
                  <button
                    onClick={() => setOpenTab(isOpen ? null : tabIndex)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-all flex items-center justify-between ${
                      isOpen ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100 text-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className={`text-sm font-semibold whitespace-nowrap transition-opacity duration-200 ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>{tab.label}</span>
                    </div>
                  </button>

                  {isOpen && isSidebarHovered && (
                    <div className="pl-7 space-y-1">
                      {visibleSubcategories.map((subLabel, subIndex) => (
                        <button
                          key={`${tab.label}-${subLabel}`}
                          onClick={() => {
                            const originalSubIndex = tab.subcategories.findIndex((s) => s === subLabel);
                            setSelected({ tab: tabIndex, sub: originalSubIndex >= 0 ? originalSubIndex : subIndex });
                            setOpenTab(tabIndex);
                            setIsTopSectionCollapsed(true);
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-all ${
                            selected.tab === tabIndex && selected.sub === subIndex
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'hover:bg-gray-100 text-gray-700'
                          }`}
                        >
                          {subLabel}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        <div className="p-3 border-t border-gray-200 flex items-center justify-center">
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40"
            title={`Logout ${currentUser?.first_name || currentUser?.email || ''}`}
          >
            {currentUserPhotoUrl ? (
              <img
                src={currentUserPhotoUrl}
                alt={currentUser?.first_name || 'Profile'}
                className="h-10 w-10 rounded-full object-cover border border-gray-200"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-sm font-semibold border border-gray-300">
                {(currentUser?.first_name || currentUser?.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar menu button */}
      <button
        onClick={() => setIsMobileSidebarOpen(true)}
        className="fixed bottom-24 right-5 z-[70] md:hidden flex items-center gap-2 px-4 py-3 bg-primary text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
        title="Open menu"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="font-medium whitespace-nowrap">Menu</span>
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
            <div className="p-4 space-y-1">
              <button
                onClick={() => {
                  setSelected({ tab: null, sub: null });
                  setOpenTab(null);
                  setIsTopSectionCollapsed(false);
                  setSearchQuery('');
                  setIsSearchFocused(false);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-all ${
                  selected.tab === null && selected.sub === null
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-gray-100 text-gray-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <HomeIcon className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-semibold">Dashboard</span>
                </div>
              </button>
              {ADMIN_TABS
                .filter(tab => !tab.requiresAdmin || isAdmin)
                .map((tab, tabIndex) => {
                  const visibleSubcategories = tab.subcategories.filter(
                    (subLabel) => !HIDDEN_ADMIN_SUBCATEGORY_LABELS.has(subLabel)
                  );
                  if (visibleSubcategories.length === 0) return null;
                  const isOpen = openTab === tabIndex;
                  const Icon = tab.icon;

                  return (
                    <div key={`mobile-${tab.label}`} className="space-y-1">
                      <button
                        onClick={() => setOpenTab(isOpen ? null : tabIndex)}
                        className={`w-full rounded-lg px-3 py-2.5 text-left transition-all flex items-center justify-between ${
                          isOpen ? 'bg-primary/10 text-primary' : 'hover:bg-gray-100 text-gray-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="text-sm font-semibold">{tab.label}</span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="pl-7 space-y-1">
                          {visibleSubcategories.map((subLabel, subIndex) => (
                            <button
                              key={`mobile-${tab.label}-${subLabel}`}
                              onClick={() => {
                                const originalSubIndex = tab.subcategories.findIndex((s) => s === subLabel);
                                setSelected({ tab: tabIndex, sub: originalSubIndex >= 0 ? originalSubIndex : subIndex });
                                setOpenTab(tabIndex);
                                setIsTopSectionCollapsed(true);
                                setIsMobileSidebarOpen(false);
                              }}
                              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-all ${
                                selected.tab === tabIndex && selected.sub === subIndex
                                  ? 'bg-primary/10 text-primary font-semibold'
                                  : 'hover:bg-gray-100 text-gray-700'
                              }`}
                            >
                              {subLabel}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div
        className="flex-1 overflow-y-auto px-2 sm:px-3 md:px-6 py-4 md:py-6 transition-all duration-300 md:ml-24"
      >
        {/* Top nav + search */}
        <div className="max-w-6xl mx-auto mb-3 flex flex-col lg:flex-row lg:flex-nowrap lg:items-center lg:justify-between gap-2.5" ref={searchBoxRef}>
          <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-black/10 scrollbar-track-transparent">
            {topLinks.map((item) => (
              <button
                key={`${item.tabIndex}-${item.subIndex}-${item.label}`}
                type="button"
                onClick={() => {
                  setSelected({ tab: item.tabIndex, sub: item.subIndex });
                  setOpenTab(item.tabIndex);
                  setIsTopSectionCollapsed(true);
                }}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  selected.tab === item.tabIndex && selected.sub === item.subIndex
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-700 hover:bg-white hover:shadow-sm'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-80 lg:flex-shrink-0">
            <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
            <input
              type="text"
              className="w-full h-9 rounded-xl border border-white/80 bg-white pl-10 pr-4 text-sm text-gray-700 placeholder:text-gray-400 shadow-[0_8px_24px_rgba(17,24,39,0.08),0_1px_2px_rgba(17,24,39,0.06)] focus:outline-none focus:ring-2 focus:ring-[#e7bcc7]/50 focus:shadow-[0_12px_28px_rgba(17,24,39,0.12),0_2px_6px_rgba(17,24,39,0.08)] transition-shadow"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
            />
            {isSearchFocused && (
              <div className="absolute right-0 top-full z-20 w-full bg-white border border-gray-200 rounded-xl shadow-xl mt-2 max-h-80 overflow-y-auto">
                {filteredSections.length > 0 ? (
                  filteredSections.map((section) => (
                    <button
                      key={section.key}
                      onClick={() => handleSearchSelect(section)}
                      className="w-full text-left px-4 py-2 hover:bg-primary/5 flex items-center justify-between gap-4"
                    >
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{section.subLabel}</p>
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
            )}
          </div>
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

          {/* Quick action cards (boxed) */}
          <div
            className={`flex md:grid md:grid-cols-2 lg:grid-cols-5 gap-6 max-w-6xl mx-auto transition-all duration-500 ease-in-out overflow-x-auto scrollbar-hide pb-2 md:pb-0 ${isTopSectionCollapsed ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-screen'
              }`}
          >
            <button
              type="button"
              onClick={() => {
                const usersTab = ADMIN_TABS.findIndex(tab => tab.label === 'Authentication');
                const usersSub = ADMIN_TABS[usersTab]?.subcategories.findIndex(sub => sub === 'Users');
                setSelected({ tab: usersTab, sub: usersSub || 0 });
                setOpenTab(null);
                setIsTopSectionCollapsed(true);
              }}
              className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-md shadow-sm bg-[#f4ecff] text-gray-800 relative overflow-hidden p-6 h-32 w-64 md:w-auto border border-[#eadbff]"
            >
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/40 blur-2xl" />
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/70 border border-white shadow-sm">
                  <svg className="w-7 h-7 text-[#8a63d2] opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[#342b56] leading-tight">Users</div>
                  <div className="text-[#6d6791] text-xs font-medium mt-1">Manage Users</div>
                </div>
              </div>
              <svg className="absolute bottom-2 right-2 w-16 h-8 opacity-30" fill="none" stroke="#7f78a8" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
            </button>

            <button
              type="button"
              onClick={() => {
                const employeesTab = ADMIN_TABS.findIndex(tab => tab.label === 'Tenants');
                const employeesSub = ADMIN_TABS[employeesTab]?.subcategories.findIndex(sub => sub === 'Employees');
                setSelected({ tab: employeesTab, sub: employeesSub || 0 });
                setOpenTab(null);
                setIsTopSectionCollapsed(true);
              }}
              className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-md shadow-sm bg-[#eaf0ff] text-gray-800 relative overflow-hidden p-6 h-32 w-64 md:w-auto border border-[#d6e2ff]"
            >
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/45 blur-2xl" />
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/70 border border-white shadow-sm">
                  <svg className="w-7 h-7 text-[#4b63c9] opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-[#2f3f7a] leading-tight">Employees</div>
                  <div className="text-[#5f73a8] text-xs font-medium mt-1">Manage Team</div>
                </div>
              </div>
              <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-30" fill="none" stroke="#6d81bd" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10" /><rect x="10" y="10" width="4" height="20" /><rect x="18" y="16" width="4" height="14" /><rect x="26" y="6" width="4" height="24" /><rect x="34" y="14" width="4" height="16" /></svg>
            </button>

            <button
              type="button"
              onClick={() => {
                const sourcesTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
                const sourcesSub = ADMIN_TABS[sourcesTab]?.subcategories.findIndex(sub => sub === 'Lead Sources');
                setSelected({ tab: sourcesTab, sub: sourcesSub || 0 });
                setOpenTab(null);
                setIsTopSectionCollapsed(true);
              }}
              className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-md shadow-sm bg-[#e8f8f2] text-gray-800 relative overflow-hidden p-6 h-32 w-64 md:w-auto border border-[#cfeede]"
            >
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/45 blur-2xl" />
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/70 border border-white shadow-sm">
                  <svg className="w-7 h-7 text-[#2d947b] opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[#2a5f50] leading-tight">Sources</div>
                  <div className="text-[#578874] text-xs font-medium mt-1">Lead Sources</div>
                </div>
              </div>
              <svg className="absolute bottom-2 right-2 w-10 h-10 opacity-30" fill="none" stroke="#5a9f86" strokeWidth="2" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" /><text x="16" y="21" textAnchor="middle" fontSize="10" fill="#5a9f86" opacity="0.8">99+</text></svg>
            </button>

            <button
              type="button"
              onClick={() => {
                const contractsTab = ADMIN_TABS.findIndex(tab => tab.label === 'Misc');
                const contractsSub = ADMIN_TABS[contractsTab]?.subcategories.findIndex(sub => sub === 'Contract templates');
                setSelected({ tab: contractsTab, sub: contractsSub || 0 });
                setOpenTab(null);
                setIsTopSectionCollapsed(true);
              }}
              className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-md shadow-sm bg-[#efeafd] text-gray-800 relative overflow-hidden p-6 h-32 w-64 md:w-auto border border-[#ddd2fb]"
            >
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/45 blur-2xl" />
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/70 border border-white shadow-sm">
                  <svg className="w-7 h-7 text-[#6d57be] opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[#3d2f72] leading-tight">Contracts</div>
                  <div className="text-[#7464a7] text-xs font-medium mt-1">Templates</div>
                </div>
              </div>
              <svg className="absolute bottom-2 right-2 w-16 h-8 opacity-30" fill="none" stroke="#7b6ba8" strokeWidth="2" viewBox="0 0 64 32"><polyline points="2,28 16,20 32,24 48,10 62,18" /></svg>
            </button>

            <button
              type="button"
              onClick={() => {
                const accessLogsTab = ADMIN_TABS.findIndex(tab => tab.label === 'Hooks');
                const accessLogsSub = ADMIN_TABS[accessLogsTab]?.subcategories.findIndex(sub => sub === 'Access Logs');
                setSelected({ tab: accessLogsTab, sub: accessLogsSub || 0 });
                setOpenTab(null);
                setIsTopSectionCollapsed(true);
              }}
              className="flex-shrink-0 rounded-2xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-md shadow-sm bg-[#e7f6f1] text-gray-800 relative overflow-hidden p-6 h-32 w-64 md:w-auto border border-[#cdebe0]"
            >
              <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-white/45 blur-2xl" />
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/70 border border-white shadow-sm">
                  <svg className="w-7 h-7 text-[#3d9b7b] opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-[#2f5e50] leading-tight">Access</div>
                  <div className="text-[#5f877b] text-xs font-medium mt-1">Logs</div>
                </div>
              </div>
              <svg className="absolute bottom-2 right-2 w-12 h-8 opacity-30" fill="none" stroke="#5b9c88" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="8" width="4" height="16" /><rect x="8" y="12" width="4" height="12" /><rect x="14" y="6" width="4" height="18" /><rect x="20" y="10" width="4" height="14" /><rect x="26" y="14" width="4" height="10" /><rect x="32" y="4" width="4" height="20" /><rect x="38" y="8" width="4" height="16" /></svg>
            </button>
          </div>
        </div>

        {/* Dashboard: team overview + expandable user changes — only when no admin page is selected */}
        {selected.tab === null && selected.sub === null && (
          <div className="w-full max-w-5xl mx-auto mt-10 md:mt-14 px-2 sm:px-3 md:px-0">
            <section className="pb-10 md:pb-12 border-b border-gray-200/90">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 mb-2">Team overview</h2>
              <p className="text-sm text-gray-600 leading-relaxed max-w-2xl mb-8">
                Active staff linked to <span className="font-medium text-gray-800">tenants_employee</span>. Role counts use
                <span className="font-medium text-gray-800"> employee_field_assignments</span>. Includes today meetings stats.
              </p>

              {dashboardStatsLoading ? (
                <div className="flex justify-start py-8">
                  <span className="loading loading-spinner loading-md text-gray-400" />
                </div>
              ) : dashboardStats ? (
                <>
                  <div className="mb-10 md:mb-12">
                    <p className="text-sm text-gray-500 mb-1">Active employees</p>
                    <p className="text-5xl md:text-6xl font-semibold text-gray-900 tabular-nums tracking-tight">
                      {dashboardStats.totalActiveEmployees}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">Staff users linked to tenants_employee</p>
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-8">
                    {(
                      [
                        { key: 'handlers', label: 'Handlers', value: dashboardStats.handlers },
                        { key: 'sales', label: 'Sales', value: dashboardStats.sales },
                        { key: 'marketing', label: 'Marketing', value: dashboardStats.marketing },
                        { key: 'finance', label: 'Finance', value: dashboardStats.finance },
                        { key: 'administration', label: 'Administration', value: dashboardStats.administration },
                      ] as const
                    ).map((row, idx) => (
                      <div
                        key={row.key}
                        className={
                          idx > 0 ? 'lg:border-l lg:border-gray-200/80 lg:pl-8' : ''
                        }
                      >
                        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">{row.label}</dt>
                        <dd className="mt-1.5 text-2xl md:text-3xl font-semibold text-gray-900 tabular-nums">
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-10 bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 mb-4">Meetings Today</p>
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Active client</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900 tabular-nums">
                          {dashboardStats.activeClientMeetingsToday}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Staff meetings</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900 tabular-nums">
                          {dashboardStats.staffMeetingsToday}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">Potential client</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900 tabular-nums">
                          {dashboardStats.potentialClientMeetingsToday}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </>
              ) : null}
            </section>

            <section className="pt-10 md:pt-12">
              <div className="w-full py-3 border-b border-gray-200/90">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  User change history
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Recent account and profile changes (up to 500 rows)
                </p>
              </div>

              <div className="pt-6">
                {fullUserChangesLoading ? (
                  <div className="flex justify-start py-10">
                    <span className="loading loading-spinner loading-md text-gray-400" />
                  </div>
                ) : fullUserChanges.length === 0 ? (
                  <p className="text-sm text-gray-500 py-6">No user changes found</p>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
                    <div className="overflow-x-auto max-h-[min(70vh,560px)] overflow-y-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th scope="col" className="py-3 pr-4 font-medium text-gray-500 whitespace-nowrap sticky top-0 bg-white z-[1]">
                              User
                            </th>
                            <th scope="col" className="py-3 pr-4 font-medium text-gray-500 whitespace-nowrap sticky top-0 bg-white z-[1]">
                              Updated by
                            </th>
                            <th scope="col" className="py-3 pr-4 font-medium text-gray-500 min-w-[12rem] sticky top-0 bg-white z-[1]">
                              Changes
                            </th>
                            <th scope="col" className="py-3 font-medium text-gray-500 whitespace-nowrap sticky top-0 bg-white z-[1]">
                              Time
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {fullUserChanges.map(change => (
                            <tr key={`${change.type}-${change.id}`} className="align-top hover:bg-gray-50/50">
                              <td className="py-3 pr-4 font-medium text-gray-900 whitespace-nowrap">
                                {change.user_name}
                              </td>
                              <td className="py-3 pr-4 text-gray-600 whitespace-nowrap">
                                {change.updated_by_name || '—'}
                              </td>
                              <td className="py-3 pr-4 text-gray-700 break-words max-w-xl leading-relaxed">
                                {change.info || '—'}
                              </td>
                              <td className="py-3 text-gray-500 whitespace-nowrap tabular-nums text-xs">
                                {new Date(change.created_at).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* Collapse/Expand Button */}
        <div className="relative">
          <button
            onClick={() => setIsTopSectionCollapsed(!isTopSectionCollapsed)}
            className="fixed top-24 right-4 md:right-8 z-50 p-2 md:p-3 rounded-full bg-[#4B18D2] text-white border border-[#4B18D2]/80 shadow-[0_10px_26px_rgba(75,24,210,0.34)] transition-all duration-300 transform hover:scale-110 hover:bg-[#4214BC]"
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
                  selectedTab?.subcategories[selected.sub] === 'Firm types' ? (
                  <div className="w-full">
                    <FirmTypesManager />
                  </div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Firms' ? (
                  <div className="w-full">
                    <FirmsManager />
                  </div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Firm contacts' ? (
                  <div className="w-full">
                    <FirmContactsManager />
                  </div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Channels' ? (
                  <div className="w-full">
                    <ChannelsManager />
                  </div>
                ) : selectedTab?.label === 'Tenants' &&
                  selectedTab?.subcategories[selected.sub] === 'Meeting Locations' ? (
                  <div className="w-full">
                    <MeetingLocationsManager />
                  </div>
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
                  selectedTab?.subcategories[selected.sub] === 'Flag Types' ? (
                  <div className="w-full"><FlagTypesManager /></div>
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
        {/* Admin page scoped style overrides */}
        <style>{`
          .admin-page-shell table {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            border-collapse: separate !important;
            border-spacing: 0 10px !important;
          }

          /* Kill global index.css rectangular hover on <tr> (boxy strip) */
          .admin-page-shell .table tbody tr:hover {
            background-color: transparent !important;
          }
          html.dark .admin-page-shell .table tbody tr:hover {
            background-color: transparent !important;
          }

          /*
           * Rounded rows: round first/last <td> (reliable). Do NOT use tr::before — in WebKit/Blink
           * it can generate an extra table cell and shift every column.
           */
          .admin-page-shell table tbody tr {
            background: transparent !important;
            border-radius: 18px !important;
            overflow: hidden !important;
            box-shadow: none !important;
          }

          .admin-page-shell table tbody tr:hover {
            box-shadow: none !important;
          }

          .admin-page-shell table tbody td {
            border: none !important;
            border-bottom: none !important;
            background: #ffffff !important;
            box-shadow: none !important;
            vertical-align: middle;
          }

          .admin-page-shell table tbody td:first-child {
            border-top-left-radius: 18px !important;
            border-bottom-left-radius: 18px !important;
            padding-left: 1.1rem !important;
          }

          .admin-page-shell table tbody td:last-child {
            border-top-right-radius: 18px !important;
            border-bottom-right-radius: 18px !important;
            padding-right: 1.1rem !important;
          }

          .admin-page-shell table tbody tr:hover td {
            background: #f1f5f9 !important;
          }

          html.dark .admin-page-shell table tbody tr {
            box-shadow: none !important;
          }

          html.dark .admin-page-shell table tbody tr:hover {
            box-shadow: none !important;
          }

          html.dark .admin-page-shell table tbody td {
            background: rgba(255, 255, 255, 0.06) !important;
          }

          html.dark .admin-page-shell table tbody tr:hover td {
            background: rgba(255, 255, 255, 0.10) !important;
          }

          .admin-page-shell input[type='search'],
          .admin-page-shell input[placeholder*='search' i] {
            border-radius: 9999px !important;
            background: #ffffff !important;
            border: 1px solid rgba(229, 231, 235, 0.95) !important;
            box-shadow: 0 8px 22px rgba(17, 24, 39, 0.08), 0 1px 3px rgba(17, 24, 39, 0.06) !important;
            transition: box-shadow 0.2s ease, transform 0.2s ease;
          }

          .admin-page-shell input[type='search']:focus,
          .admin-page-shell input[placeholder*='search' i]:focus {
            box-shadow: 0 12px 28px rgba(17, 24, 39, 0.12), 0 2px 6px rgba(17, 24, 39, 0.08) !important;
          }

          .admin-page-shell table thead,
          .admin-page-shell table thead tr,
          .admin-page-shell table thead th {
            background-color: transparent !important;
            background-image: none !important;
            border-bottom: none !important;
          }

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