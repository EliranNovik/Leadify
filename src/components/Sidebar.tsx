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
  isOpen: boolean;
  onClose: () => void;
  onOpenAIChat: () => void;
  userName?: string;
  userInitials?: string | null;
}

interface SidebarItem {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  path: string;
}

const sidebarItems: SidebarItem[] = [
  { icon: HomeIcon, label: 'Dashboard', path: '/' },
  { icon: UserGroupIcon, label: 'Clients', path: '/clients' },
  { icon: CalendarIcon, label: 'Calendar', path: '/calendar' },
  { icon: CalendarIcon, label: 'Outlook Calendar', path: '/outlook-calendar' },
  { icon: ChartBarIcon, label: 'Pipeline', path: '/pipeline' },
  { icon: BanknotesIcon, label: 'Collection', path: '/collection' },
  { icon: UserIcon, label: 'Expert', path: '/expert' },
  { icon: TagIcon, label: 'My Leads', path: '/my-leads' },
  { icon: FolderPlusIcon, label: 'New Cases', path: '/new-cases' },
  { icon: FolderIcon, label: 'My Cases', path: '/my-cases' },
  { icon: ChartPieIcon, label: 'My Performance', path: '/performance' },
  { icon: PlusCircleIcon, label: 'Create New', path: '/create' },
  { icon: DocumentChartBarIcon, label: 'Reports', path: '/reports' },
  { icon: MagnifyingGlassIcon, label: 'Lead Search', path: '/lead-search' },
  { icon: Cog6ToothIcon, label: 'Admin Panel', path: '/admin' },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, onOpenAIChat, userName = 'John Doe', userInitials }) => {
  const location = useLocation();
  const initials = userInitials || userName.split(' ').map(n => n[0]).join('');

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const sidebarClasses = "flex flex-col h-full bg-base-100 text-base-content";

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="w-16 hover:w-64 transition-all duration-500 ease-out shadow-lg group hidden md:block">
        <div className={sidebarClasses}>
          {/* AI Button */}
          <div className="h-16 flex items-center justify-center border-b border-base-200">
            <button
              onClick={onOpenAIChat}
              className="btn btn-ghost btn-circle hover:bg-base-200 hover:scale-110 transition-all duration-300 ease-out"
            >
              <SparklesIcon className="w-6 h-6 text-primary" />
            </button>
            <span className="ml-2 font-semibold text-lg opacity-0 group-hover:opacity-100">
              AI Assistant
            </span>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-y-auto py-4">
            <ul className="space-y-2 px-2">
              {sidebarItems.map((item, index) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <li key={index}>
                    <Link
                      to={item.path}
                      className={`flex items-center p-2 rounded-lg transition-all duration-300 ease-out hover:scale-105 hover:shadow-md
                        ${isActive 
                          ? 'bg-primary text-primary-content shadow-lg' 
                          : 'hover:bg-base-200'
                        }`}
                    >
                      <Icon className="w-6 h-6 min-w-[1.5rem]" />
                      <span className="ml-4 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-400 ease-out transform translate-x-2 group-hover:translate-x-0">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* User Profile Section */}
          <div className="p-4 border-t border-base-200">
            <div className="flex items-center">
              <button
                className="btn btn-circle btn-ghost text-purple-700 border-none text-2xl transition-all duration-300 ease-out hover:scale-110 hover:bg-base-200"
                title="Sign out"
                onClick={handleSignOut}
              >
                <ArrowRightOnRectangleIcon className="w-7 h-7" />
              </button>
              <div className="ml-4 opacity-0 group-hover:opacity-100 transition-all duration-400 ease-out transform translate-x-2 group-hover:translate-x-0">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-base-content/70">Admin</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar */}
      <div className={`md:hidden fixed inset-y-0 left-0 z-40 w-64 bg-base-100 shadow-lg transform transition-all duration-400 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className={sidebarClasses}>
          {/* Header with Close Button */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-base-200">
            <button
              onClick={() => { onOpenAIChat(); onClose(); }}
              className="flex items-center gap-2 btn btn-ghost transition-all duration-300 ease-out hover:scale-105"
            >
              <SparklesIcon className="w-6 h-6 text-primary" />
              <span className="font-semibold text-lg">AI Assistant</span>
            </button>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-circle transition-all duration-200 ease-out hover:scale-110 hover:bg-base-200"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation Items */}
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
                      className={`flex items-center p-2 rounded-lg transition-all duration-300 ease-out hover:scale-105 hover:shadow-md
                        ${isActive 
                          ? 'bg-primary text-primary-content shadow-lg' 
                          : 'hover:bg-base-200'
                        }`}
                    >
                      <Icon className="w-6 h-6 min-w-[1.5rem]" />
                      <span className="ml-4 whitespace-nowrap">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* User Profile Section */}
          <div className="p-4 border-t border-base-200">
            <div className="flex items-center">
              <button
                className="btn btn-circle btn-ghost text-purple-700 border-none text-2xl transition-all duration-300 ease-out hover:scale-110 hover:bg-base-200"
                title="Sign out"
                onClick={handleSignOut}
              >
                <ArrowRightOnRectangleIcon className="w-7 h-7" />
              </button>
              <div className="ml-4">
                <p className="text-sm font-medium">{userName}</p>
                <p className="text-xs text-base-content/70">Admin</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay when mobile sidebar is open */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30 transition-opacity duration-400 ease-out"
          onClick={onClose}
        />
      )}
    </>
  );
};

export default Sidebar; 