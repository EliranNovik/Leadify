import React from 'react';
import { useLocation, Link } from 'react-router-dom';
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
  isOpen?: boolean;
  onClose?: () => void;
}

interface SidebarItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  path: string;
}

const sidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  // { icon: UserGroupIcon, label: 'Clients', path: '/clients' }, // commented out
  // { icon: CalendarIcon, label: 'Calendar', path: '/calendar' }, // moved to header
  { icon: CalendarIcon, label: 'Outlook Calendar', path: '/outlook-calendar' },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
  { icon: FolderPlusIcon, label: 'New Cases', path: '/new-cases' },
  { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
  { icon: DocumentChartBarIcon, label: 'Case Manager', path: '/case-manager' },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
  // { icon: DocumentChartBarIcon, label: 'Reports', path: '/reports' }, // moved to header
  // { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' }, // moved to header
  { icon: Cog6ToothIcon, label: 'Admin Panel', path: '/admin' },
];

const Sidebar: React.FC<SidebarProps> = ({ userName = 'John Doe', userInitials, isOpen = false, onClose }) => {
  const location = useLocation();
  const initials = userInitials || userName.split(' ').map(n => n[0]).join('');

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
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <>
      {/* Desktop/Tablet Sidebar */}
      <div className={`fixed top-0 left-0 h-full flex flex-col items-center ${isSmallGap ? 'gap-1' : 'gap-3'} py-4 z-40 bg-transparent mr-8 pr-2 ml-4 mt-16 hidden md:flex`}>
        {/* Navigation Items */}
        <nav className={`flex flex-col mt-2 ${isSmallGap ? 'gap-2' : 'gap-6'}`}>
          {sidebarItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={index}
                to={item.path}
                className={`sidebar-circle group${isActive ? ' sidebar-active sidebar-active-purple' : ''}`}
              >
                <span className="sidebar-icon-wrapper">
                  <Icon className={`w-6 h-6 transition-colors duration-200 ${isActive ? 'text-white' : 'text-gray-700'} group-hover:text-gray-900`} />
                </span>
                <span className={`sidebar-label ${isActive ? 'text-white' : 'text-black'}`}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {/* User Profile/Sign Out */}
        <div className="mt-4 flex flex-col items-center gap-1">
          {/* Custom styles for sidebar */}
          <style>{`
            .sidebar-circle {
              width: 48px;
              height: 48px;
              background: rgba(255,255,255,0.35);
              border-radius: 9999px;
              display: flex;
              align-items: center;
              justify-content: flex-start;
              position: relative;
              transition: width 0.3s cubic-bezier(.4,0,.2,1), background 0.2s;
              overflow: hidden;
              box-shadow: 0 4px 24px 0 rgba(0,0,0,0.08), 0 1.5px 8px 0 rgba(0,0,0,0.04);
              cursor: pointer;
              border: 1.5px solid rgba(0,0,0,0.08);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
            }
            .sidebar-icon-wrapper {
              display: flex;
              align-items: center;
              justify-content: center;
              margin-left: 8px;
            }
            .sidebar-circle:hover {
              width: 220px;
              /* No background color change on hover */
            }
            .sidebar-active,
            .sidebar-circle.sidebar-active,
            .sidebar-active-purple {
              background: #3b28c7 !important; /* Header purple from screenshot */
              color: #fff !important;
              box-shadow: 0 4px 24px 0 rgba(59,40,199,0.18), 0 1.5px 8px 0 rgba(59,40,199,0.08);
              border: 1.5px solid #3b28c7;
            }
            .sidebar-circle.sidebar-active .sidebar-icon-wrapper svg,
            .sidebar-active-purple .sidebar-icon-wrapper svg {
              color: #fff !important;
            }
            .sidebar-circle.sidebar-active .sidebar-label,
            .sidebar-active-purple .sidebar-label {
              color: #fff !important;
            }
            .sidebar-label {
              opacity: 0;
              white-space: nowrap;
              margin-left: 20px;
              font-weight: 500;
              font-size: 1rem;
              color: #111;
              transition: opacity 0.2s, color 0.2s;
            }
            .sidebar-circle:hover .sidebar-label {
              opacity: 1;
            }
            .sidebar-circle .w-6, .sidebar-circle .w-7 {
              min-width: 1.5rem;
              min-height: 1.5rem;
              width: 1.5rem;
              height: 1.5rem;
            }
            .sidebar-circle-sm {
              width: 32px !important;
              height: 32px !important;
            }
            .sidebar-icon-wrapper-sm {
              margin-left: 4px;
            }
            .sidebar-noexpand:hover {
              width: 32px !important;
            }
          `}</style>
          {/*
            NOTE: To make space for the sidebar, add 'pl-28' or 'pl-32' to your main content container.
            Example: <div className="pl-32"> ... </div>
          */}
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
                {sidebarItems.map((item, index) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <li key={index}>
                      <Link
                        to={item.path}
                        onClick={onClose}
                        className={`flex items-center p-3 rounded-lg transition-all duration-200 hover:scale-105 hover:shadow-md ${
                          isActive 
                            ? 'sidebar-active-purple text-white shadow-lg' 
                            : 'text-base-content'
                        }`}
                      >
                        <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-white' : 'text-black'}`} />
                        <span className={`ml-3 font-medium ${isActive ? 'text-white' : 'text-black'}`}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            
            {/* Footer with user info and sign out */}
            <div className="p-4 border-t border-base-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary text-primary-content rounded-full flex items-center justify-center font-semibold">
                    {initials}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{userName}</p>
                    <p className="text-xs text-base-content/60">User</p>
                  </div>
                </div>
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