import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { FaRobot } from 'react-icons/fa';
import { useAdminRole } from '../hooks/useAdminRole';
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
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface SidebarProps {
  userName?: string;
  userInitials?: string | null;
  userRole?: string;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenAIChat?: () => void;
}

interface SidebarItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  path?: string;
  subItems?: SidebarItem[];
}

const desktopSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  {
    icon: CalendarIcon,
    label: 'Calendar',
    subItems: [
      { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
      { icon: CalendarIcon, label: 'Outlook Calendar', path: '/outlook-calendar' },
    ],
  },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  {
    icon: MagnifyingGlassIcon,
    label: 'Leads',
    subItems: [
      { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
      { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' },
      { icon: FolderPlusIcon, label: 'New Cases', path: '/new-cases' },
      { icon: FolderPlusIcon, label: 'New Handler Cases', path: '/new-handler-cases' },
      { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
    ],
  },
  { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
  { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: Cog6ToothIcon, label: 'Admin Panel', path: '/admin' },
];

const mobileSidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  {
    icon: CalendarIcon,
    label: 'Calendar',
    subItems: [
      { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
      { icon: CalendarIcon, label: 'Outlook Calendar', path: '/outlook-calendar' },
    ],
  },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  {
    icon: MagnifyingGlassIcon,
    label: 'Leads',
    subItems: [
      { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
      { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' },
      { icon: FolderPlusIcon, label: 'New Cases', path: '/new-cases' },
      { icon: FolderPlusIcon, label: 'New Handler Cases', path: '/new-handler-cases' },
      { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
    ],
  },
  { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
  { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: DocumentChartBarIcon, label: 'Reports', path: '/reports' },
  { icon: UserGroupIcon, label: 'Teams', path: '/teams' },
  { icon: Cog6ToothIcon, label: 'Admin Panel', path: '/admin' },
];

const Sidebar: React.FC<SidebarProps> = ({ userName = 'John Doe', userInitials, userRole = 'User', isOpen = false, onClose, onOpenAIChat }) => {
  const location = useLocation();
  const initials = userInitials || userName.split(' ').map(n => n[0]).join('');
  const { isAdmin } = useAdminRole();

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

  return (
    <>
      {/* Desktop/Tablet Sidebar */}
      <div className="hidden md:block">
        <div
          ref={sidebarRef}
          className={`fixed top-20 left-4 flex flex-col bg-gradient-to-b from-indigo-700 via-purple-700 to-teal-600 shadow-2xl z-40 ${isSidebarHovered ? 'w-64' : 'w-20'} transition-all duration-300 group/sidebar rounded-2xl max-h-[calc(100vh-2rem)] min-h-[120px] border border-white/10`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Navigation Items */}
          <nav className="flex flex-col mt-8 gap-2 flex-1">
            {desktopSidebarItems
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
                      className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer group/sidebar-link
                        ${isActive ? 'bg-white/10 text-white font-bold shadow-lg border-l-4 border-cyan-300' : 'text-white/90 hover:bg-white/20 hover:text-white'} relative`}
                    >
                      <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-cyan-300' : 'text-white/90 group-hover/sidebar-link:text-white'}`} />
                      <span className={`ml-2 text-base font-medium transition-opacity duration-200 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>
                        {item.label}
                      </span>
                    </Link>
                  )}
                  {hasSubItems && (
                    <>
                      <button
                        className={`flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer w-full group/sidebar-link
                          ${isActive ? 'bg-white/10 text-white font-bold shadow-lg border-l-4 border-cyan-300' : 'text-white/90 hover:bg-white/20 hover:text-white'}`}
                        onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                        type="button"
                      >
                        <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-cyan-300' : 'text-white/90 group-hover/sidebar-link:text-white'}`} />
                        <span className={`ml-2 text-base font-medium transition-opacity duration-200 whitespace-nowrap ${isSidebarHovered ? 'opacity-100' : 'opacity-0'}`}>
                          {item.label}
                        </span>
                        <svg className={`w-4 h-4 ml-auto transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''} opacity-0 group-hover/sidebar:opacity-100`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </button>
                      {isExpanded && (
                        <div className="ml-8 mt-1 flex flex-col gap-1 bg-white/10 rounded-xl p-2 border border-white/10">
                          {item.subItems!.map((sub, subIdx) => {
                            const SubIcon = sub.icon;
                            const isSubActive = sub.path && location.pathname === sub.path;
                            return (
                              <Link
                                key={subIdx}
                                to={sub.path!}
                                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer
                                  ${isSubActive ? 'bg-white/20 text-cyan-300 font-bold border-l-4 border-cyan-300 shadow' : 'text-white/90 hover:bg-white/20 hover:text-white'}`}
                                onClick={() => setExpandedMenu(item.label)}
                              >
                                <SubIcon className={`w-5 h-5 min-w-[1.25rem] ${isSubActive ? 'text-cyan-300' : 'text-white/90 group-hover/sidebar-link:text-white'}`} />
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

          {/* Settings and Sign out buttons */}
          <div className="flex flex-col items-center px-4 py-6 border-t border-white/10 mt-4 w-full gap-3">
            <div className={`flex items-center w-full ${isSidebarHovered ? 'justify-between' : 'justify-center flex-col gap-3'}`}>
              {/* Settings button */}
              <div className="relative group">
                <Link
                  to="/settings"
                  className="bg-white/10 text-white rounded-lg p-2 flex items-center justify-center shadow border border-white/20 hover:border-cyan-300 hover:bg-cyan-400/20 transition-colors duration-200"
                  title="Settings"
                >
                  <Cog6ToothIcon className="w-6 h-6" />
                </Link>
                {!isSidebarHovered && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 bg-black/90 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap z-50 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-200">
                    Settings
                  </div>
                )}
              </div>
              
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
            </div>
          </div>
        </div>
      </div>

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
          className={`fixed inset-y-0 left-0 w-64 bg-base-100 shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
            isOpen ? 'translate-x-0' : '-translate-x-full'
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
                {mobileSidebarItems
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
                          className={`flex items-center p-3 rounded-lg transition-all duration-200
                            ${isActive ? 'bg-[#3b28c7] text-white font-bold' : 'text-base-content hover:bg-[#edeafd] hover:text-[#3b28c7]'}
                            hover:scale-105 hover:shadow-md`}
                        >
                          <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-white' : 'text-black group-hover:text-[#3b28c7]'}`} />
                          <span className={`ml-3 font-medium ${isActive ? 'text-white' : 'text-black group-hover:text-[#3b28c7]'}`}>{item.label}</span>
                        </Link>
                      )}
                      {hasSubItems && (
                        <>
                          <button
                            className={`flex items-center p-3 rounded-lg w-full transition-all duration-200 hover:scale-105 hover:shadow-md ${
                              item.label === 'Calendar' || item.label === 'Leads'
                                ? (isExpanded ? 'bg-white text-black font-bold shadow-lg' : 'text-black hover:bg-purple-100 hover:text-purple-700')
                                : (isExpanded ? 'sidebar-active-purple text-white shadow-lg' : 'text-base-content')
                            }`}
                            onClick={() => setExpandedMenu(isExpanded ? null : item.label)}
                            type="button"
                          >
                            <Icon className={`w-6 h-6 min-w-[1.5rem] ${
                              item.label === 'Calendar' || item.label === 'Leads'
                                ? (isExpanded ? 'text-black' : 'text-black hover:text-purple-700')
                                : (isExpanded ? 'text-white' : 'text-black')
                            }`} />
                            <span className={`ml-3 font-medium ${
                              item.label === 'Calendar' || item.label === 'Leads'
                                ? (isExpanded ? 'text-black' : 'text-black hover:text-purple-700')
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
                                      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 cursor-pointer ${
                                        item.label === 'Calendar' || item.label === 'Leads'
                                          ? (isSubActive ? 'bg-purple-600 text-white font-bold shadow' : 'text-black hover:bg-purple-100 hover:text-purple-700')
                                          : (isSubActive ? 'bg-white text-black font-bold shadow' : 'text-white hover:bg-white hover:text-black')
                                      }`}
                                    >
                                      <SubIcon className={`w-5 h-5 min-w-[1.25rem] ${
                                        item.label === 'Calendar' || item.label === 'Leads'
                                          ? (isSubActive ? 'text-white' : 'text-black hover:text-purple-700')
                                          : (isSubActive ? 'text-black' : 'group-hover/sidebar-link:text-black text-white')
                                      }`} />
                                      <span className="text-base font-medium whitespace-nowrap opacity-100">{sub.label}</span>
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
                    className="flex items-center p-3 rounded-lg w-full transition-all duration-200 text-black hover:bg-purple-100 hover:text-purple-700 hover:scale-105 hover:shadow-md"
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
            
            {/* Footer with settings and sign out */}
            <div className="p-4 border-t border-base-200">
              <div className="flex items-center justify-center gap-4">
                <Link
                  to="/settings"
                  className="btn btn-ghost btn-circle btn-sm"
                  title="Settings"
                  onClick={onClose}
                >
                  <Cog6ToothIcon className="w-5 h-5" />
                </Link>
                <button 
                  className="btn btn-ghost btn-circle btn-sm" 
                  title="Sign out" 
                  onClick={handleSignOut}
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar; 