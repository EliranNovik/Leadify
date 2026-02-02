import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { FaRobot } from 'react-icons/fa';
import { useAdminRole } from '../hooks/useAdminRole';
import { useExternalUser } from '../hooks/useExternalUser';
import { toast } from 'react-hot-toast';
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
  DocumentChartBarIcon,
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
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { useAuthContext } from '../contexts/AuthContext';

interface SidebarProps {
  userName?: string;
  userInitials?: string | null;
  userRole?: string;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAIChat?: () => void;
  mobileOnly?: boolean; // If true, only show mobile sidebar, hide desktop sidebar
}

interface SidebarItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  path?: string;
  subItems?: SidebarItem[];
}

const desktopSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
  { icon: ReceiptRefundIcon, label: 'Waiting for Price Offer', path: '/waiting-for-price-offer' },
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
      { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
    ],
  },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: UserGroupIcon, label: 'Employee Performance', path: '/employee-performance' },
  { icon: DocumentArrowUpIcon, label: 'Documents', path: '/documents' },
  { icon: ChatBubbleLeftRightIcon, label: 'WhatsApp Leads', path: '/whatsapp-leads' },
  { icon: EnvelopeIcon, label: 'Email Leads', path: '/email-leads' },
  { icon: PhoneIcon, label: 'Calls Ledger', path: '/calls-ledger' },
  { icon: Cog6ToothIcon, label: 'Settings', path: '/settings' },
  { icon: ShieldCheckIcon, label: 'Admin Panel', path: '/admin' },
];

const mobileSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
  { icon: ReceiptRefundIcon, label: 'Waiting for Price Offer', path: '/waiting-for-price-offer' },
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
      { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
    ],
  },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: UserGroupIcon, label: 'Employee Performance', path: '/employee-performance' },
  { icon: DocumentArrowUpIcon, label: 'Documents', path: '/documents' },
  { icon: ChatBubbleLeftRightIcon, label: 'WhatsApp Leads', path: '/whatsapp-leads' },
  { icon: EnvelopeIcon, label: 'Email Leads', path: '/email-leads' },
  { icon: PhoneIcon, label: 'Calls Ledger', path: '/calls-ledger' },
  { icon: DocumentChartBarIcon, label: 'Reports', path: '/reports' },
  // { icon: UserGroupIcon, label: 'Teams', path: '/teams' },
  { icon: Cog6ToothIcon, label: 'Settings', path: '/settings' },
  { icon: ShieldCheckIcon, label: 'Admin Panel', path: '/admin' },
];

const Sidebar: React.FC<SidebarProps> = ({ userName = 'John Doe', userInitials, userRole = 'User', isOpen = false, onClose, onOpenAIChat, mobileOnly = false }) => {
  const location = useLocation();
  const initials = userInitials || userName.split(' ').map(n => n[0]).join('');
  const { isAdmin } = useAdminRole();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const { user: authUser, isInitialized } = useAuthContext();

  // State for user role and department from database
  const [userRoleFromDB, setUserRoleFromDB] = React.useState<string>('User');
  const [userDepartment, setUserDepartment] = React.useState<string>('');
  const [userOfficialName, setUserOfficialName] = React.useState<string>('');
  const [isSuperUser, setIsSuperUser] = React.useState<boolean>(false);
  const [isLoadingUserInfo, setIsLoadingUserInfo] = React.useState<boolean>(false); // Start as false to not block UI

  // Helper function to get role display name
  const getRoleDisplayName = (role: string): string => {
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
      'P': 'Partner',
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
    return roleMap[role?.toLowerCase()] || role || 'User';
  };

  // Fetch user role and department from database using new employee relationship
  React.useEffect(() => {
    // Wait for auth to be initialized before fetching
    if (!isInitialized) {
      return;
    }

    const fetchUserInfo = async (retryCount = 0) => {
      // Don't set loading to true - run in background to not block UI
      try {

        // Get the current auth user
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError) {
          console.error('Error getting auth user:', authError);
          setIsLoadingUserInfo(false);
          return;
        }

        if (!user) {
          // No user logged in
          setIsLoadingUserInfo(false);
          return;
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
              department_id,
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
                department_id,
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
          // Set superuser status
          setIsSuperUser(userData.is_superuser === true || userData.is_superuser === 'true' || userData.is_superuser === 1);

          if (userData.tenants_employee) {
            // Handle both array and single object responses
            const empData = Array.isArray(userData.tenants_employee) ? userData.tenants_employee[0] : userData.tenants_employee;

            if (empData) {
              // Set official name (use official_name if available, fallback to display_name or full_name)
              const officialName = empData.official_name || empData.display_name || userData.full_name || user.email || '';
              setUserOfficialName(officialName);

              // Set role with proper mapping
              const roleDisplay = getRoleDisplayName(empData.bonuses_role || '');
              setUserRoleFromDB(roleDisplay);

              // Set department
              const deptData = Array.isArray(empData.tenant_departement) ? empData.tenant_departement[0] : empData.tenant_departement;
              const deptName = deptData?.name || 'General';
              setUserDepartment(deptName);
            } else {
              // No employee data, use basic user info
              setUserOfficialName(userData.full_name || user.email || '');
              setUserRoleFromDB('User');
            }
          } else {
            // No employee relationship, use basic user info
            setUserOfficialName(userData.full_name || user.email || '');
            setUserRoleFromDB('User');
          }
        } else {
          // User not found in database, use auth user info
          console.warn('User not found in database, using auth user info');
          setUserOfficialName(user.email || '');
          setUserRoleFromDB('User');
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

    // Listen for auth state changes to refetch user info
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session?.user) {
          // Refetch user info when session is refreshed or user signs in
          fetchUserInfo();
        }
      } else if (event === 'SIGNED_OUT') {
        // Clear user info on sign out
        setUserOfficialName('');
        setUserRoleFromDB('User');
        setUserDepartment('');
        setIsSuperUser(false);
      }
    });

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
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

  const handleSignOut = async () => {
    try {
      console.log('Signing out from sidebar...');
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        toast.error('Failed to sign out');
      } else {
        console.log('Successfully signed out from sidebar');
        toast.success('Signed out successfully');
        // Navigate to login page instead of reload
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Unexpected error during sign out:', error);
      toast.error('Failed to sign out');
    }
  };

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
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setIsSidebarHovered(true), 250);
  };
  // Handler for mouse leave (immediate collapse)
  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsSidebarHovered(false);
  };

  // Filter sidebar items based on superuser status
  const filteredDesktopItems = React.useMemo(() => {
    if (isSuperUser) return desktopSidebarItems;
    return desktopSidebarItems
      .filter(item =>
        item.label !== 'WhatsApp Leads' &&
        item.label !== 'Email Leads' &&
        item.label !== 'Calls Ledger'
      )
      .map(item => {
        // Filter subItems to remove "Assign Leads" for non-superusers
        if (item.subItems) {
          return {
            ...item,
            subItems: item.subItems.filter(subItem =>
              isSuperUser || subItem.path !== '/new-cases'
            )
          };
        }
        return item;
      });
  }, [isSuperUser]);

  const filteredMobileItems = React.useMemo(() => {
    if (isSuperUser) return mobileSidebarItems;
    return mobileSidebarItems
      .filter(item =>
        item.label !== 'WhatsApp Leads' &&
        item.label !== 'Email Leads' &&
        item.label !== 'Calls Ledger'
      )
      .map(item => {
        // Filter subItems to remove "Assign Leads" for non-superusers
        if (item.subItems) {
          return {
            ...item,
            subItems: item.subItems.filter(subItem =>
              isSuperUser || subItem.path !== '/new-cases'
            )
          };
        }
        return item;
      });
  }, [isSuperUser]);

  // Hide sidebar completely for external users - check after all hooks are called
  // Wait for external user check to complete to prevent flash
  if (isLoadingExternal) {
    return null; // Show nothing while checking external user status
  }

  if (isExternalUser) {
    return null; // No sidebar for external users
  }

  return (
    <>
      {/* Desktop/Tablet Sidebar */}
      {!mobileOnly && (
        <div className="hidden md:block">
          <div
            ref={sidebarRef}
            className={`fixed top-20 left-4 flex flex-col shadow-2xl z-40 ${isSidebarHovered ? 'w-64' : 'w-20'} transition-all duration-300 group/sidebar rounded-2xl h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] min-h-[120px] border sidebar-frosted-glass`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Navigation Items */}
            <nav className="flex flex-col mt-8 gap-2 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30 pb-4">
              {filteredDesktopItems
                .map((item, index) => {
                  const Icon = item.icon;
                  const hasSubItems = !!item.subItems;
                  const isExpanded = expandedMenu === item.label;
                  // Highlight parent if itself or any subItem is active
                  const isActive = (item.path && location.pathname === item.path) || isSubItemActive(item.subItems);
                  return (
                    <div key={index} className="relative group/sidebar-item">
                      {item.path && !hasSubItems && (
                        <Link
                          to={item.path}
                          className={`sidebar-link flex items-center gap-4 px-4 py-3 transition-all duration-200 cursor-pointer group/sidebar-link hover:bg-white/10 hover:text-white relative
                        ${isActive ? 'sidebar-link--active text-cyan-200 font-bold border-l-4 border-cyan-300' : 'text-white/80'}`}
                        >
                          <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-cyan-300' : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                          <span className={`ml-2 text-base font-medium transition-opacity duration-200 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>
                            {item.label}
                          </span>
                        </Link>
                      )}
                      {hasSubItems && (
                        <>
                          <button
                            className={`sidebar-link flex items-center gap-4 px-4 py-3 transition-all duration-200 cursor-pointer w-full group/sidebar-link hover:bg-white/10 hover:text-white
                          ${isActive ? 'sidebar-link--active text-cyan-200 font-bold border-l-4 border-cyan-300' : 'text-white/80'}`}
                            onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                            type="button"
                          >
                            <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-cyan-300' : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                            <span className={`ml-2 text-base font-medium transition-opacity duration-200 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>
                              {item.label}
                            </span>
                            <svg className={`w-4 h-4 ml-auto transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} opacity-0 group-hover/sidebar:opacity-100`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                          </button>
                          {isExpanded && (
                            <div className="ml-8 mt-1 flex flex-col gap-1 p-2 border-l border-white/15">
                              {item.subItems!.map((sub, subIdx) => {
                                const SubIcon = sub.icon;
                                const isSubActive = sub.path && location.pathname === sub.path;
                                return (
                                  <Link
                                    key={subIdx}
                                    to={sub.path!}
                                    className={`sidebar-sublink flex items-center gap-3 px-3 py-2 transition-all duration-200 cursor-pointer hover:bg-white/10 hover:text-white
                                  ${isSubActive ? 'sidebar-sublink--active text-cyan-200 font-semibold border-l-4 border-cyan-300' : 'text-white/80'}`}
                                    onClick={() => setExpandedMenu(item.label)}
                                  >
                                    <SubIcon className={`w-5 h-5 min-w-[1.25rem] ${isSubActive ? 'text-cyan-300' : 'text-white/80 group-hover/sidebar-link:text-white'}`} />
                                    <span className={`text-base font-medium transition-opacity duration-200 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>{sub.label}</span>
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

            {/* User info and sign out button */}
            <div className="flex flex-col px-4 py-6 border-t border-white/10 mt-auto w-full gap-3 flex-shrink-0">
              <div className={`flex items-center w-full justify-start gap-3`}>
                {/* Sign out button */}
                <div className="relative group">
                  <button
                    className="bg-white/10 text-white rounded-lg p-2 flex items-center justify-center shadow border border-white/20 hover:border-cyan-300 hover:bg-cyan-400/20 transition-colors duration-200"
                    title="Sign out"
                    onClick={handleSignOut}
                  >
                    <ArrowRightOnRectangleIcon className="w-6 h-6" />
                  </button>
                  {!isSidebarHovered && (
                    <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-black/90 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200">
                      Sign out
                    </div>
                  )}
                </div>

                {/* User info - only visible when sidebar is expanded */}
                {isSidebarHovered && (
                  <div className="flex flex-col min-w-0">
                    {isLoadingUserInfo ? (
                      <span className="text-white/70 text-xs truncate">Loading...</span>
                    ) : (
                      <>
                        <span className="text-white font-medium text-sm truncate">
                          {userOfficialName || authUser?.email || userName}
                        </span>
                        <span className="text-white/70 text-xs truncate">
                          {userRoleFromDB}
                        </span>
                        {userDepartment && (
                          <span className="text-white/50 text-xs truncate">
                            {userDepartment}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Sidebar Drawer */}
      <div className="md:hidden">
        {/* Overlay */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
            onClick={onClose}
          />
        )}

        {/* Drawer */}
        <div
          className={`fixed inset-y-0 left-0 w-64 bg-base-100 shadow-2xl z-50 transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'
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
            <nav className="flex-1 overflow-y-auto py-4">
              <ul className="space-y-2 px-2">
                {filteredMobileItems
                  .map((item, index) => {
                    const Icon = item.icon;
                    const isActive = item.path && location.pathname === item.path;
                    const hasSubItems = !!item.subItems;
                    const isExpanded = expandedMenu === item.label;
                    return (
                      <li key={index} className="relative">
                        {item.path && !hasSubItems && (
                          <Link
                            to={item.path}
                            onClick={onClose}
                            className={`group flex items-center p-3 rounded-lg transition-all duration-200
                            ${isActive ? 'bg-[#3b28c7] text-white font-bold' : 'text-base-content'}`}
                          >
                            <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-white' : 'text-black'}`} />
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
                              <Icon className={`w-6 h-6 min-w-[1.5rem] ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
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
                                          ? (isSubActive ? 'bg-purple-600 text-white font-bold shadow' : 'text-black')
                                          : (isSubActive ? 'bg-white text-black font-bold shadow' : 'text-black')
                                          }`}
                                      >
                                        <SubIcon className={`w-5 h-5 min-w-[1.25rem] ${item.label === 'Calendar' || item.label === 'Leads' || item.label === 'Cases'
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
                    <FaRobot className="w-6 h-6 min-w-[1.5rem] text-primary" />
                    <span className="ml-3 font-medium text-black">AI Assistant</span>
                  </button>
                </li>
              </ul>
            </nav>

            {/* Footer with user info and sign out */}
            <div className="p-4 border-t border-base-200">
              <div className="flex items-center justify-start gap-3">
                <button
                  className="btn btn-ghost btn-circle btn-sm"
                  title="Sign out"
                  onClick={handleSignOut}
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                </button>

                {/* User info - always visible on mobile */}
                <div className="flex flex-col min-w-0">
                  {isLoadingUserInfo ? (
                    <span className="text-base-content/70 text-xs truncate">Loading...</span>
                  ) : (
                    <>
                      <span className="text-base-content font-medium text-sm truncate">
                        {userOfficialName || authUser?.email || userName}
                      </span>
                      <span className="text-base-content/70 text-xs truncate">
                        {userRoleFromDB}
                      </span>
                      {userDepartment && (
                        <span className="text-base-content/50 text-xs truncate">
                          {userDepartment}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default React.memo(Sidebar); 