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
      <div className="fixed top-0 left-0 h-full flex flex-col bg-base-100 shadow-lg z-40 w-20 hover:w-64 transition-all duration-300 group/sidebar mt-16">
        {/* Navigation Items */}
        <nav className="flex flex-col mt-8 gap-2 flex-1">
          {sidebarItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={index}
                to={item.path}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 cursor-pointer group/sidebar-link ${isActive ? 'bg-primary text-white font-bold shadow-lg' : 'hover:bg-base-200 text-base-content'}`}
              >
                <Icon className={`w-6 h-6 min-w-[1.5rem] ${isActive ? 'text-white' : 'text-primary'}`} />
                <span className="ml-2 text-base font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
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