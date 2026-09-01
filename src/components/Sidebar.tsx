import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { RmqAiLogo } from './RmqAiLogo';
import { useAdminRole } from '../hooks/useAdminRole';
import { useExternalUser, shouldDeferInternalChrome } from '../hooks/useExternalUser';
import {
  HomeIcon,
  UserGroupIcon,
  CalendarIcon,
  ChartBarIcon,
  BanknotesIcon,
  UserIcon,
  TagIcon,
  FolderPlusIcon,
  FolderIcon,
  ChartPieIcon,
  PlusCircleIcon,
  PlusIcon,
  DocumentChartBarIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
  SparklesIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ArrowRightOnRectangleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
  PhoneIcon,
  FireIcon,
  DocumentArrowUpIcon,
  ReceiptRefundIcon,
  EnvelopeIcon,
  BriefcaseIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';
import { getMobileAwareCacheTtlMs } from '../lib/mobileCache';
import { canAccessLeadTimeReport } from '../lib/employeeLeadReporting';
import { getRoleDisplayName } from '../lib/employeeRoles';

interface SidebarProps {
  userName?: string;
  userInitials?: string | null;
  userRole?: string;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAIChat?: () => void;
  mobileOnly?: boolean; // If true, only show mobile sidebar, hide desktop sidebar
  /** On Clients detail: hide floating pill; show docked panel when dockedOpen. */
  presentation?: 'floating' | 'docked';
  dockedOpen?: boolean;
  onDockedClose?: () => void;
  /** Tailwind classes for docked panel position (default under Clients rail). */
  dockedPositionClassName?: string;
  /** Tailwind classes for docked panel surface. */
  dockedSurfaceClassName?: string;
  /** Light (white) docked rail — active/hover use gray fills instead of white chips. */
  dockedOnLight?: boolean;
}

interface SidebarItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  path?: string;
  subItems?: SidebarItem[];
}

const isCollectionFlag = (value: unknown) =>
  value === true || value === 't' || value === 'true' || value === 1;

const ADD_EXPENSE_SIDEBAR_ITEM: SidebarItem = {
  icon: PlusIcon,
  label: 'Add expense',
  path: '/reports/finance-management?tab=expense-entry',
};

const withFinanceNavForRole = (items: SidebarItem[], canSeeFinancePipeline: boolean): SidebarItem[] => {
  if (canSeeFinancePipeline) return items;
  return items.map((item) =>
    item.label === 'Finance Pipeline' ? ADD_EXPENSE_SIDEBAR_ITEM : item,
  );
};

const navPathname = (path?: string) => (path ? path.split('?')[0] : '');

const desktopSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  // { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
  { icon: ReceiptRefundIcon, label: 'Waiting for Price Offer', path: '/waiting-for-price-offer' },
  { icon: BanknotesIcon, label: 'Finance Pipeline', path: '/reports/finance-management' },
  { icon: UserGroupIcon, label: 'HR Management', path: '/reports/hr-management' },
  { icon: FireIcon, label: 'Hot Leads', path: '/scheduler-tool' },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  {
    icon: MagnifyingGlassIcon,
    label: 'Leads',
    subItems: [
      { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
      { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' },
      { icon: ExclamationTriangleIcon, label: 'Double Leads', path: '/double-leads' },
      // { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
      { icon: FolderPlusIcon, label: 'Assign Leads', path: '/new-cases' },
    ],
  },
  {
    icon: FolderIcon,
    label: 'Cases',
    subItems: [
      { icon: FolderPlusIcon, label: 'New Handler Cases', path: '/new-handler-cases' },
      { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
      { icon: ChartBarIcon, label: 'Case Pipeline', path: '/case-pipeline' },
      { icon: BriefcaseIcon, label: 'Retention Cases', path: '/retainer-handler-cases' },
      { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
    ],
  },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: ClipboardDocumentListIcon, label: 'Lead time report', path: '/lead-time-report' },
  // { icon: UserGroupIcon, label: 'Employee Performance', path: '/employee-performance' },
  // { icon: DocumentArrowUpIcon, label: 'Documents', path: '/documents' },
  { icon: ChatBubbleLeftRightIcon, label: 'WhatsApp Leads', path: '/whatsapp-leads' },
  { icon: EnvelopeIcon, label: 'Email Leads', path: '/email-leads' },
  { icon: PhoneIcon, label: 'Calls Ledger', path: '/calls-ledger' },
  { icon: Cog6ToothIcon, label: 'Settings', path: '/settings' },
  { icon: ShieldCheckIcon, label: 'Admin Panel', path: '/admin' },
];

const mobileSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  // { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
  { icon: ReceiptRefundIcon, label: 'Waiting for Price Offer', path: '/waiting-for-price-offer' },
  { icon: BanknotesIcon, label: 'Finance Pipeline', path: '/reports/finance-management' },
  { icon: UserGroupIcon, label: 'HR Management', path: '/reports/hr-management' },
  { icon: FireIcon, label: 'Hot Leads', path: '/scheduler-tool' },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  {
    icon: MagnifyingGlassIcon,
    label: 'Leads',
    subItems: [
      { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
      { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' },
      { icon: ExclamationTriangleIcon, label: 'Double Leads', path: '/double-leads' },
      // { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
      { icon: FolderPlusIcon, label: 'Assign Leads', path: '/new-cases' },
    ],
  },
  {
    icon: FolderIcon,
    label: 'Cases',
    subItems: [
      { icon: FolderPlusIcon, label: 'New Handler Cases', path: '/new-handler-cases' },
      { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
      { icon: ChartBarIcon, label: 'Case Pipeline', path: '/case-pipeline' },
      { icon: BriefcaseIcon, label: 'Retention Cases', path: '/retainer-handler-cases' },
      { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
    ],
  },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: ClipboardDocumentListIcon, label: 'Lead time report', path: '/lead-time-report' },
  // { icon: UserGroupIcon, label: 'Employee Performance', path: '/employee-performance' },
  // { icon: DocumentArrowUpIcon, label: 'Documents', path: '/documents' },
  { icon: ChatBubbleLeftRightIcon, label: 'WhatsApp Leads', path: '/whatsapp-leads' },
  { icon: EnvelopeIcon, label: 'Email Leads', path: '/email-leads' },
  { icon: PhoneIcon, label: 'Calls Ledger', path: '/calls-ledger' },
  { icon: DocumentChartBarIcon, label: 'Reports', path: '/reports' },
  // { icon: UserGroupIcon, label: 'Teams', path: '/teams' },
  { icon: Cog6ToothIcon, label: 'Settings', path: '/settings' },
  { icon: ShieldCheckIcon, label: 'Admin Panel', path: '/admin' },
];

const Sidebar: React.FC<SidebarProps> = ({
  userName = '',
  userInitials,
  userRole = 'User',
  isOpen = false,
  onClose,
  onOpenAIChat,
  mobileOnly = false,
  presentation = 'floating',
  dockedOpen = false,
  onDockedClose,
  dockedPositionClassName = 'fixed bottom-0 left-[4.75rem] z-40 top-[var(--client-detail-nav-top,7.25rem)]',
  dockedSurfaceClassName = 'bg-white dark:bg-base-100',
  dockedOnLight = false,
}) => {
  const isDockedPresentation = presentation === 'docked';
  const showDockedDesktop = isDockedPresentation && dockedOpen;
  const showFloatingDesktop = !isDockedPresentation;
  // Check if alternative (green) theme is active - make it reactive
  const [isAltTheme, setIsAltTheme] = useState(() => document.documentElement.classList.contains('theme-alt'));

  useEffect(() => {
    const checkTheme = () => {
      const hasThemeAlt = document.documentElement.classList.contains('theme-alt');
      setIsAltTheme(hasThemeAlt);
    };

    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
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
    window.addEventListener('storage', handleStorageChange);

    return () => {
      observer.disconnect();
      window.removeEventListener('themechange', handleThemeChange as EventListener);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
  const location = useLocation();
  const { isAdmin } = useAdminRole();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const { user: authUser, isInitialized, userFullName, userInitials: authUserInitials, isSuperUser } = useAuthContext();

  // State for user role and department from database
  // Initialize from cache immediately (synchronous) for instant display
  const getInitialUserInfo = () => {
    try {
      const cacheKey = 'sidebar_userData';
      const cacheTimestampKey = 'sidebar_userData_timestamp';
      const cacheUserIdKey = 'sidebar_userData_userId';
      const CACHE_DURATION = getMobileAwareCacheTtlMs(30 * 60 * 1000);

      const cachedData = sessionStorage.getItem(cacheKey);
      const cachedTimestamp = sessionStorage.getItem(cacheTimestampKey);
      const cachedUserId = sessionStorage.getItem(cacheUserIdKey);

      // Check if we have a current user to validate cache
      const currentUserId = authUser?.id;

      if (cachedData && cachedTimestamp && cachedUserId) {
        const age = Date.now() - parseInt(cachedTimestamp, 10);
        // Only use cache if it's for the current user (or if we don't have current user yet, use it anyway)
        const isValidCache = age < CACHE_DURATION && (!currentUserId || cachedUserId === currentUserId);

        if (isValidCache) {
          const data = JSON.parse(cachedData);
          return {
            userOfficialName: data.userOfficialName || '',
            userRoleFromDB: data.userRoleFromDB || 'User',
            userDepartment: data.userDepartment || '',
            bonusesRole: typeof data.bonusesRole === 'string' ? data.bonusesRole : '',
            leadTimeReportingEnabled: data.leadTimeReportingEnabled === true,
            hasCollectionAccess: data.hasCollectionAccess === true,
            isSuperUser: data.isSuperUser || false,
            cachedUserId: cachedUserId
          };
        }
      }
    } catch (e) {
      // Ignore cache errors
    }
    return {
      userOfficialName: userFullName || userName || authUser?.email || '',
      userRoleFromDB: 'User',
      userDepartment: '',
      bonusesRole: '',
      leadTimeReportingEnabled: false,
      hasCollectionAccess: false,
      isSuperUser: false,
      cachedUserId: null
    };
  };

  const initialUserInfo = getInitialUserInfo();
  // Initialize state with cached values - these will display immediately
  const [userRoleFromDB, setUserRoleFromDB] = React.useState<string>(initialUserInfo.userRoleFromDB);
  const [userDepartment, setUserDepartment] = React.useState<string>(initialUserInfo.userDepartment);
  const [bonusesRole, setBonusesRole] = React.useState<string>(initialUserInfo.bonusesRole || '');
  const [leadTimeReportingEnabled, setLeadTimeReportingEnabled] = React.useState<boolean>(
    initialUserInfo.leadTimeReportingEnabled === true,
  );
  const [hasCollectionAccess, setHasCollectionAccess] = React.useState<boolean>(
    initialUserInfo.hasCollectionAccess === true,
  );
  // Use cached name, then AuthContext, then prop, then email
  const initialName = initialUserInfo.userOfficialName || userFullName || userName || authUser?.email || 'User';
  const [userOfficialName, setUserOfficialName] = React.useState<string>(initialName);
  const [isLoadingUserInfo, setIsLoadingUserInfo] = React.useState<boolean>(false); // Always false - never show loading

  // Sync display name from AuthContext as soon as user is available so we don't show placeholder before DB fetch
  React.useEffect(() => {
    const fromContext = userFullName || authUser?.email || '';
    if (fromContext && fromContext !== 'User') {
      setUserOfficialName(prev => (prev === 'User' || prev === '' || !prev ? fromContext : prev));
    }
  }, [userFullName, authUser?.email]);

  // Compute initials immediately from available data
  const initials = React.useMemo(() => {
    // Priority: userInitials prop > authUserInitials > computed from userOfficialName > computed from userName > computed from userFullName > computed from email
    if (userInitials) return userInitials;
    if (authUserInitials) return authUserInitials;
    if (userOfficialName && userOfficialName !== 'User') {
      const parts = userOfficialName.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return userOfficialName[0]?.toUpperCase() || 'U';
    }
    if (userName) {
      const parts = userName.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return userName[0]?.toUpperCase() || 'U';
    }
    if (userFullName) {
      const parts = userFullName.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return userFullName[0]?.toUpperCase() || 'U';
    }
    if (authUser?.email) {
      return authUser.email[0]?.toUpperCase() || 'U';
    }
    return 'U';
  }, [userInitials, authUserInitials, userOfficialName, userName, userFullName, authUser?.email]);

  // Helper function to get role display name
  

  // Fetch user role and department from database using new employee relationship
  // DEFERRED: Run in background after initial render
  React.useEffect(() => {
    // Defer to next tick to allow instant render
    const timeoutId = setTimeout(() => {
      const fetchUserInfo = async (retryCount = 0) => {
        // Never set loading to true - always run in background
        try {
          if (!authUser?.id) {
            sessionStorage.removeItem('sidebar_userData');
            sessionStorage.removeItem('sidebar_userData_timestamp');
            sessionStorage.removeItem('sidebar_userData_userId');
            setUserOfficialName('');
            setUserRoleFromDB('User');
            setUserDepartment('General');
            setHasCollectionAccess(false);
            return;
          }

          const user = authUser;

          // Check cache first - but only if it's for the current user
          const cacheKey = 'sidebar_userData';
          const cacheTimestampKey = 'sidebar_userData_timestamp';
          const cacheUserIdKey = 'sidebar_userData_userId';
          const CACHE_DURATION = getMobileAwareCacheTtlMs(30 * 60 * 1000);

          try {
            const cachedData = sessionStorage.getItem(cacheKey);
            const cachedTimestamp = sessionStorage.getItem(cacheTimestampKey);
            const cachedUserId = sessionStorage.getItem(cacheUserIdKey);

            // Only use cache if it's for the current user
            if (cachedData && cachedTimestamp && cachedUserId === user.id) {
              const age = Date.now() - parseInt(cachedTimestamp, 10);
              if (age < CACHE_DURATION) {
                // Use cached data (already set in initial state, but update if needed)
                const data = JSON.parse(cachedData);
                setUserOfficialName(data.userOfficialName || '');
                setUserRoleFromDB(data.userRoleFromDB || 'User');
                setUserDepartment(data.userDepartment || 'General');
                setBonusesRole(typeof data.bonusesRole === 'string' ? data.bonusesRole : '');
                if (typeof data.hasCollectionAccess === 'boolean') {
                  setHasCollectionAccess(data.hasCollectionAccess);
                  return; // Skip fetch - use cache
                }
                // Older cache without collection flag — fall through and refresh.
              } else {
                // Cache expired - clear it
                sessionStorage.removeItem(cacheKey);
                sessionStorage.removeItem(cacheTimestampKey);
                sessionStorage.removeItem(cacheUserIdKey);
              }
            } else if (cachedUserId && cachedUserId !== user.id) {
              // Different user - clear old cache
              console.log('🔄 Sidebar: Different user detected, clearing old cache');
              sessionStorage.removeItem(cacheKey);
              sessionStorage.removeItem(cacheTimestampKey);
              sessionStorage.removeItem(cacheUserIdKey);
            }
          } catch (error) {
            console.error('Error reading sidebar user data cache:', error);
            // Clear corrupted cache
            sessionStorage.removeItem(cacheKey);
            sessionStorage.removeItem(cacheTimestampKey);
            sessionStorage.removeItem(cacheUserIdKey);
          }

          // Get current user's data with employee relationship
          let userData = null;
          let userError = null;

          // Try by auth_id first
          const { data: userDataByAuthId, error: errorByAuthId } = await supabase
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
              official_name,
              bonuses_role,
              lead_time_reporting_enabled,
              department_id,
              is_collection,
              tenant_departement!department_id(
                id,
                name
              )
            )
          `)
            .eq('auth_id', user.id)
            .maybeSingle();

          if (errorByAuthId) {
            console.error('Error fetching user by auth_id:', errorByAuthId);
          } else if (userDataByAuthId) {
            userData = userDataByAuthId;
          }

          // If not found by auth_id, try by email
          if (!userData && user.email) {
            const { data: userDataByEmail, error: errorByEmail } = await supabase
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
                official_name,
                bonuses_role,
                lead_time_reporting_enabled,
                department_id,
                is_collection,
                tenant_departement!department_id(
                  id,
                  name
                )
              )
            `)
              .eq('email', user.email)
              .maybeSingle();

            if (errorByEmail) {
              console.error('Error fetching user by email:', errorByEmail);
            } else if (userDataByEmail) {
              userData = userDataByEmail;
            }
          }

          if (userData) {
            let officialName = '';
            let roleDisplay = 'User';
            let deptName = 'General';
            let rawBonusesRole = '';
            let reportingEnabled = false;
            let collectionAccess = false;

            if (userData.tenants_employee) {
              // Handle both array and single object responses
              const empData = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;

              if (empData) {
                // Set official name (use official_name if available, fallback to display_name or full_name)
                officialName = empData.official_name || empData.display_name || userData.full_name || user.email || '';
                setUserOfficialName(officialName);

                // Set role with proper mapping
                rawBonusesRole = String(empData.bonuses_role || '').trim();
                roleDisplay = getRoleDisplayName(rawBonusesRole);
                setUserRoleFromDB(roleDisplay);
                setBonusesRole(rawBonusesRole);
                reportingEnabled =
                  empData.lead_time_reporting_enabled === true ||
                  empData.lead_time_reporting_enabled === 't' ||
                  empData.lead_time_reporting_enabled === 'true' ||
                  empData.lead_time_reporting_enabled === 1;
                setLeadTimeReportingEnabled(reportingEnabled);
                collectionAccess = isCollectionFlag(empData.is_collection);
                setHasCollectionAccess(collectionAccess);

                // Set department
                const deptData = Array.isArray(empData.tenant_departement) ? empData.tenant_departement[0] : empData.tenant_departement;
                deptName = deptData?.name || '';
                setUserDepartment(deptName); // Update immediately
              } else {
                // No employee data, use basic user info
                officialName = userData.full_name || user.email || '';
                setUserOfficialName(officialName);
                setUserRoleFromDB('User');
                setBonusesRole('');
                setLeadTimeReportingEnabled(false);
                setHasCollectionAccess(false);
                setUserDepartment(''); // Clear department if no employee data
              }
            } else {
              // No employee relationship, use basic user info
              officialName = userData.full_name || user.email || '';
              setUserOfficialName(officialName);
              setUserRoleFromDB('User');
              setBonusesRole('');
              setLeadTimeReportingEnabled(false);
              setHasCollectionAccess(false);
              setUserDepartment(''); // Clear department if no employee relationship
            }

            // Cache the data with user ID - update immediately so it's available for next render
            try {
              const dataToCache = {
                userOfficialName: officialName,
                userRoleFromDB: roleDisplay,
                userDepartment: deptName,
                bonusesRole: rawBonusesRole,
                leadTimeReportingEnabled: reportingEnabled,
                hasCollectionAccess: collectionAccess,
              };
              sessionStorage.setItem('sidebar_userData', JSON.stringify(dataToCache));
              sessionStorage.setItem('sidebar_userData_timestamp', Date.now().toString());
              sessionStorage.setItem('sidebar_userData_userId', user.id); // Store user ID with cache
              console.log('✅ Sidebar: User data cached and state updated');
            } catch (cacheError) {
              console.error('Error caching sidebar user data:', cacheError);
            }
          } else {
            // User not found in database, use auth user info
            console.warn('User not found in database, using auth user info');
            const officialName = user.email || '';
            setUserOfficialName(officialName);
            setUserRoleFromDB('User');
            setBonusesRole('');
            setHasCollectionAccess(false);
            setUserDepartment(''); // Clear department if user not found

            // Cache basic data with user ID
            try {
              const dataToCache = {
                userOfficialName: officialName,
                userRoleFromDB: 'User',
                userDepartment: 'General',
                bonusesRole: '',
                hasCollectionAccess: false,
              };
              sessionStorage.setItem('sidebar_userData', JSON.stringify(dataToCache));
              sessionStorage.setItem('sidebar_userData_timestamp', Date.now().toString());
              sessionStorage.setItem('sidebar_userData_userId', user.id); // Store user ID with cache
            } catch (cacheError) {
              console.error('Error caching sidebar user data:', cacheError);
            }
          }
        } catch (error) {
          console.error('Error fetching user info:', error);
          // Retry up to 3 times with exponential backoff
          if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
            setTimeout(() => fetchUserInfo(retryCount + 1), delay);
            return;
          }
        } finally {
          setIsLoadingUserInfo(false);
        }
      };

      fetchUserInfo();
    }, 0); // Defer to next tick

    return () => clearTimeout(timeoutId);
  }, [isInitialized, authUser?.id]); // Re-fetch when auth is initialized or user changes

  // Responsive: shrink gap on small desktop heights
  const [isSmallGap, setIsSmallGap] = React.useState(false);
  React.useEffect(() => {
    const checkGap = () => {
      setIsSmallGap(window.innerHeight < 900);
    };
    checkGap();
    window.addEventListener('resize', checkGap);
    return () => window.removeEventListener('resize', checkGap);
  }, []);

  // 3. Add state for expanded menu
  const [expandedMenu, setExpandedMenu] = React.useState<string | null>(null);

  // 1. Add a ref for the sidebar and mouse leave handler
  const sidebarRef = React.useRef<HTMLDivElement>(null);

  // 2. Add effect to close submenu on mouse leave (desktop only)
  React.useEffect(() => {
    const handleMouseLeave = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.relatedTarget as Node)) {
        setExpandedMenu(null);
      }
    };
    const sidebarEl = sidebarRef.current;
    if (sidebarEl) {
      sidebarEl.addEventListener('mouseleave', handleMouseLeave);
      return () => sidebarEl.removeEventListener('mouseleave', handleMouseLeave);
    }
  }, []);

  // 3. Helper to check if any subItem is active
  const isSubItemActive = (subItems?: SidebarItem[]) => {
    if (!subItems) return false;
    return subItems.some(sub => sub.path && location.pathname === sub.path);
  };

  // Add state and timer for hover delay
  const [isSidebarHovered, setIsSidebarHovered] = React.useState(false);
  const hoverTimeout = React.useRef<NodeJS.Timeout | null>(null);

  // Handler for mouse enter with delay
  const handleMouseEnter = () => {
    if (isDockedPresentation) return;
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsSidebarHovered(true), 80);
  };
  // Handler for mouse leave (immediate collapse)
  const handleMouseLeave = () => {
    if (isDockedPresentation) return;
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsSidebarHovered(false);
  };

  // Escape / click-away closes docked Clients app nav
  React.useEffect(() => {
    if (!showDockedDesktop) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDockedClose?.();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (sidebarRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[data-clients-app-nav-toggle]')) return;
      onDockedClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [showDockedDesktop, onDockedClose]);

  const labelsAlwaysVisible = isDockedPresentation || isSidebarHovered;

  const dockedLinkBase =
    'relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors';
  const dockedLinkActive = dockedOnLight
    ? 'bg-gray-100 font-semibold text-gray-900 dark:bg-base-200 dark:text-base-content'
    : 'bg-white font-semibold text-gray-900 shadow-sm dark:bg-base-100 dark:text-base-content';
  const dockedLinkIdle = dockedOnLight
    ? 'font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-base-content/70 dark:hover:bg-base-200/60 dark:hover:text-base-content'
    : 'font-medium text-gray-600 hover:bg-white/55 hover:text-gray-900 dark:text-base-content/70 dark:hover:bg-base-100/50 dark:hover:text-base-content';
  const dockedIconActive = 'h-5 w-5 min-w-[1.25rem] shrink-0 text-gray-800 dark:text-base-content';
  const dockedIconIdle = 'h-5 w-5 min-w-[1.25rem] shrink-0 text-gray-500 dark:text-base-content/60';

  // Filter sidebar items based on superuser status and lead time reporting opt-in
  const canSeeLeadTimeReport = canAccessLeadTimeReport({
    leadTimeReportingEnabled,
  });

  const canSeeFinancePipeline = isSuperUser || hasCollectionAccess;

  const filteredDesktopItems = React.useMemo(() => {
    const hideLeadTime = (items: SidebarItem[]) =>
      canSeeLeadTimeReport
        ? items
        : items.filter((item) => item.path !== '/lead-time-report');

    const withFinance = (items: SidebarItem[]) =>
      withFinanceNavForRole(items, canSeeFinancePipeline);

    if (isSuperUser) return withFinance(hideLeadTime(desktopSidebarItems));
    return withFinance(
      hideLeadTime(desktopSidebarItems)
        .filter(item =>
          item.label !== 'WhatsApp Leads' &&
          item.label !== 'Email Leads' &&
          item.label !== 'Calls Ledger' &&
          item.label !== 'HR Management'
        )
        .map(item => {
          // Filter subItems to remove "Assign Leads" for non-superusers
          if (item.subItems) {
            return {
              ...item,
              subItems: item.subItems.filter((subItem) =>
                isSuperUser || subItem.path !== '/new-cases'
              ),
            };
          }
          return item;
        }),
    );
  }, [isSuperUser, canSeeLeadTimeReport, canSeeFinancePipeline]);

  const filteredMobileItems = React.useMemo(() => {
    const hideLeadTime = (items: SidebarItem[]) =>
      canSeeLeadTimeReport
        ? items
        : items.filter((item) => item.path !== '/lead-time-report');

    const withFinance = (items: SidebarItem[]) =>
      withFinanceNavForRole(items, canSeeFinancePipeline);

    if (isSuperUser) return withFinance(hideLeadTime(mobileSidebarItems));
    return withFinance(
      hideLeadTime(mobileSidebarItems)
        .filter(item =>
          item.label !== 'WhatsApp Leads' &&
          item.label !== 'Email Leads' &&
          item.label !== 'Calls Ledger' &&
          item.label !== 'HR Management'
        )
        .map(item => {
          // Filter subItems to remove "Assign Leads" for non-superusers
          if (item.subItems) {
            return {
              ...item,
              subItems: item.subItems.filter((subItem) =>
                isSuperUser || subItem.path !== '/new-cases'
              ),
            };
          }
          return item;
        }),
    );
  }, [isSuperUser, canSeeLeadTimeReport, canSeeFinancePipeline]);

  // Hide internal sidebar for externals, and while external-vs-internal is resolving on `/`
  // (otherwise staff nav flashes on refresh before `useExternalUser` finishes).
  if (isExternalUser && !isLoadingExternal) {
    return null;
  }
  if (shouldDeferInternalChrome(location.pathname, isLoadingExternal)) {
    return null;
  }

  return (
    <>
      {/* Desktop/Tablet Sidebar — floating (default) or docked next to Clients rail */}
      {!mobileOnly && (showFloatingDesktop || showDockedDesktop) && (
        <div className="hidden md:block">
          <div
            ref={sidebarRef}
            className={
              showDockedDesktop
                ? `flex w-64 flex-col min-h-0 overflow-hidden ${dockedPositionClassName} ${dockedSurfaceClassName}`
                : `fixed top-20 bottom-6 left-4 z-40 flex min-h-[120px] min-h-0 flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 group/sidebar sidebar-frosted-glass ${
                    isSidebarHovered ? 'w-64' : 'w-20'
                  }`
            }
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Navigation Items — min-h-0 + flex-1 so this scrolls fully; padding only inside scroll area */}
            <nav
              className={
                showDockedDesktop
                  ? 'scrollbar-hide flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-2 pt-2.5'
                  : 'scrollbar-hide flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain px-0 pb-4 pt-2'
              }
            >
              {filteredDesktopItems
                .map((item, index) => {
                  const Icon = item.icon;
                  const hasSubItems = !!item.subItems;
                  const isExpanded = expandedMenu === item.label;
                  // Highlight parent if itself or any subItem is active
                  const isActive = (item.path && location.pathname === navPathname(item.path)) || isSubItemActive(item.subItems);

                  if (showDockedDesktop) {
                    return (
                      <div key={index} className="relative">
                        {item.path && !hasSubItems && (
                          <Link
                            to={item.path}
                            className={`${dockedLinkBase} ${isActive ? dockedLinkActive : dockedLinkIdle}`}
                          >
                            {isActive && (
                              <span
                                className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-gray-700 dark:bg-base-content"
                                aria-hidden
                              />
                            )}
                            <Icon className={isActive ? dockedIconActive : dockedIconIdle} />
                            <span className="saira-regular truncate">{item.label}</span>
                          </Link>
                        )}
                        {hasSubItems && (
                          <>
                            <button
                              type="button"
                              className={`${dockedLinkBase} ${isActive ? dockedLinkActive : dockedLinkIdle}`}
                              onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                            >
                              {isActive && (
                                <span
                                  className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-gray-700 dark:bg-base-content"
                                  aria-hidden
                                />
                              )}
                              <Icon className={isActive ? dockedIconActive : dockedIconIdle} />
                              <span className="saira-regular min-w-0 flex-1 truncate text-left">{item.label}</span>
                              <svg
                                className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 dark:text-base-content/60 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-gray-300/80 py-0.5 pl-2 dark:border-base-content/15">
                                {item.subItems!.map((sub, subIdx) => {
                                  const SubIcon = sub.icon;
                                  const isSubActive = !!(sub.path && location.pathname === sub.path);
                                  return (
                                    <Link
                                      key={subIdx}
                                      to={sub.path!}
                                      className={`${dockedLinkBase} py-2 ${isSubActive ? dockedLinkActive : dockedLinkIdle}`}
                                      onClick={() => setExpandedMenu(item.label)}
                                    >
                                      <SubIcon className={isSubActive ? dockedIconActive : dockedIconIdle} />
                                      <span className="saira-regular truncate">{sub.label}</span>
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={index} className="relative group/sidebar-item">
                      {item.path && !hasSubItems && (
                        <Link
                          to={item.path}
                          className={`sidebar-link group/sidebar-link relative flex cursor-pointer items-center gap-4 px-4 py-3 transition-all duration-200 hover:bg-white/10 hover:text-white
                        ${isActive ? (isAltTheme ? 'sidebar-link--active border-l-4 border-green-300 font-bold text-green-200' : 'sidebar-link--active border-l-4 border-cyan-300 font-bold text-cyan-200') : 'text-white/80'}`}
                        >
                          <Icon className={`h-7 w-7 min-w-[1.75rem] ${isActive ? (isAltTheme ? 'text-green-300' : 'text-cyan-300') : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                          <span className={`ml-2 whitespace-nowrap text-base font-medium transition-opacity duration-200 ${labelsAlwaysVisible ? 'opacity-100' : 'opacity-0'}`}>
                            {item.label}
                          </span>
                        </Link>
                      )}
                      {hasSubItems && (
                        <>
                          <button
                            className={`sidebar-link group/sidebar-link flex w-full cursor-pointer items-center gap-4 px-4 py-3 transition-all duration-200 hover:bg-white/10 hover:text-white
                          ${isActive ? (isAltTheme ? 'sidebar-link--active border-l-4 border-green-300 font-bold text-green-200' : 'sidebar-link--active border-l-4 border-cyan-300 font-bold text-cyan-200') : 'text-white/80'}`}
                            onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                            type="button"
                          >
                            <Icon className={`h-7 w-7 min-w-[1.75rem] ${isActive ? (isAltTheme ? 'text-green-300' : 'text-cyan-300') : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                            <span className={`ml-2 whitespace-nowrap text-base font-medium transition-opacity duration-200 ${labelsAlwaysVisible ? 'opacity-100' : 'opacity-0'}`}>
                              {item.label}
                            </span>
                            <svg className={`ml-auto h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} ${labelsAlwaysVisible ? 'opacity-100' : 'opacity-0 group-hover/sidebar:opacity-100'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                          {isExpanded && (
                            <div className="ml-8 mt-1 flex flex-col gap-1 border-l border-white/15 p-2">
                              {item.subItems!.map((sub, subIdx) => {
                                const SubIcon = sub.icon;
                                const isSubActive = sub.path && location.pathname === sub.path;
                                return (
                                  <Link
                                    key={subIdx}
                                    to={sub.path!}
                                    className={`sidebar-sublink flex cursor-pointer items-center gap-3 px-3 py-2 transition-all duration-200 hover:bg-white/10 hover:text-white
                                  ${isSubActive ? (isAltTheme ? 'sidebar-sublink--active border-l-4 border-green-300 font-semibold text-green-200' : 'sidebar-sublink--active border-l-4 border-cyan-300 font-semibold text-cyan-200') : 'text-white/80'}`}
                                    onClick={() => setExpandedMenu(item.label)}
                                  >
                                    <SubIcon className={`h-6 w-6 min-w-[1.5rem] ${isSubActive ? (isAltTheme ? 'text-green-300' : 'text-cyan-300') : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                                    <span className={`whitespace-nowrap text-base font-medium transition-opacity duration-200 ${labelsAlwaysVisible ? 'opacity-100' : 'opacity-0'}`}>{sub.label}</span>
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
            </nav>
          </div>
        </div>
      )}

      {/* Mobile Sidebar Drawer */}
      <div className="md:hidden">
        {/* Overlay - z-[60] to stay above bottom nav (z-40) */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-[60] transition-opacity duration-300"
            onClick={onClose}
          />
        )}

        {/* Drawer - z-[60] to stay above bottom nav (z-40) */}
        <div
          className={`fixed inset-y-0 left-0 w-64 bg-base-100 shadow-2xl z-[60] transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
        >
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-base-200">
              <span className="font-semibold text-lg">Menu</span>
              <button
                onClick={onClose}
                className="btn btn-ghost btn-circle"
                aria-label="Close menu"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Navigation */}
            <nav className="scrollbar-hide flex-1 overflow-y-auto py-4">
              <ul className="space-y-2 px-2">
                {filteredMobileItems
                  .map((item, index) => {
                    const Icon = item.icon;
                    const isActive = item.path && location.pathname === navPathname(item.path);
                    const hasSubItems = !!item.subItems;
                    const isExpanded = expandedMenu === item.label;
                    return (
                      <li key={index} className="relative">
                        {item.path && !hasSubItems && (
                          <Link
                            to={item.path}
                            onClick={onClose}
                            className={`group flex items-center p-3 rounded-lg transition-all duration-200
                            ${isActive ? (isAltTheme ? 'bg-green-600 text-white font-bold' : 'bg-[#3b28c7] text-white font-bold') : 'text-base-content'}`}
                          >
                            <Icon className={`w-7 h-7 min-w-[1.75rem] ${isActive ? 'text-white' : 'text-black'}`} />
                            <span className={`ml-3 font-medium ${isActive ? 'text-white' : 'text-black'}`}>{item.label}</span>
                          </Link>
                        )}
                        {hasSubItems && (
                          <>
                            <button
                              className={`group flex items-center p-3 rounded-lg w-full transition-all duration-200 ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                ? (isExpanded ? 'bg-white text-black font-bold shadow-lg' : 'text-black')
                                : (isExpanded ? 'sidebar-active-purple text-white shadow-lg' : 'text-base-content')
                                }`}
                              onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                              type="button"
                            >
                              <Icon className={`w-7 h-7 min-w-[1.75rem] ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                ? (isExpanded ? 'text-black' : 'text-black')
                                : (isExpanded ? 'text-white' : 'text-black')
                                }`} />
                              <span className={`ml-3 font-medium ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                ? (isExpanded ? 'text-black' : 'text-black')
                                : (isExpanded ? 'text-white' : 'text-black')
                                }`}>{item.label}</span>
                              <svg className={`w-4 h-4 ml-auto transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                            </button>
                            {isExpanded && (
                              <ul className="ml-8 mt-1 flex flex-col gap-1">
                                {item.subItems!.map((sub, subIdx) => {
                                  const SubIcon = sub.icon;
                                  const isSubActive = sub.path && location.pathname === sub.path;
                                  return (
                                    <li key={subIdx}>
                                      <Link
                                        to={sub.path!}
                                        onClick={onClose}
                                        className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                          ? (isSubActive ? (isAltTheme ? 'bg-green-600 text-white font-bold shadow' : 'bg-purple-600 text-white font-bold shadow') : 'text-black')
                                          : (isSubActive ? 'bg-white text-black font-bold shadow' : 'text-black')
                                          }`}
                                      >
                                        <SubIcon className={`w-6 h-6 min-w-[1.5rem] ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                          ? (isSubActive ? 'text-white' : 'text-black')
                                          : (isSubActive ? 'text-black' : 'text-black')
                                          }`} />
                                        <span className={`text-base font-medium whitespace-nowrap opacity-100 ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
                                          ? (isSubActive ? 'text-white' : 'text-black')
                                          : (isSubActive ? 'text-black' : 'text-black')
                                          }`}>{sub.label}</span>
                                      </Link>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                {/* AI Assistant - Mobile Only */}
                <li>
                  <button
                    className="flex items-center p-3 rounded-lg w-full transition-all duration-200 text-black"
                    onClick={() => {
                      if (onOpenAIChat) onOpenAIChat();
                      if (onClose) onClose();
                    }}
                  >
                    <RmqAiLogo className="h-7 w-7 min-w-[1.75rem]" />
                    <span className="ml-3 font-medium text-black">AI Assistant</span>
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(Sidebar); 