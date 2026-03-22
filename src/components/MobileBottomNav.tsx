import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  CalendarIcon,
  MagnifyingGlassIcon,
  FireIcon,
  ChartBarIcon,
  DocumentChartBarIcon,
  FolderPlusIcon,
  BoltIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import {
  CalendarIcon as CalendarIconSolid,
  MagnifyingGlassIcon as MagnifyingGlassIconSolid,
  FireIcon as FireIconSolid,
  ChartBarIcon as ChartBarIconSolid,
  DocumentChartBarIcon as DocumentChartBarIconSolid,
  FolderPlusIcon as FolderPlusIconSolid,
} from '@heroicons/react/24/solid';
import { FaWhatsapp } from 'react-icons/fa';
import { useAdminRole } from '../hooks/useAdminRole';
import { useNewLeadsCount } from '../hooks/useNewLeadsCount';

interface MobileBottomNavProps {
  onOpenMessaging?: () => void;
  onOpenWhatsApp?: () => void;
  onOpenEmailThread?: () => void;
}

const navItems = [
  {
    path: '/calendar',
    label: 'Calendar',
    Icon: CalendarIcon,
    IconActive: CalendarIconSolid,
  },
  {
    path: '/lead-search',
    label: 'Lead Search',
    Icon: MagnifyingGlassIcon,
    IconActive: MagnifyingGlassIconSolid,
  },
  {
    path: '/scheduler-tool',
    label: 'Hot Leads',
    Icon: FireIcon,
    IconActive: FireIconSolid,
  },
  {
    path: '/pipeline',
    label: 'Pipeline',
    Icon: ChartBarIcon,
    IconActive: ChartBarIconSolid,
  },
  {
    path: '/reports',
    label: 'Reports',
    Icon: DocumentChartBarIcon,
    IconActive: DocumentChartBarIconSolid,
  },
  {
    path: '/new-cases',
    label: 'Assign Leads',
    Icon: FolderPlusIcon,
    IconActive: FolderPlusIconSolid,
    superUserOnly: true,
  },
  {
    path: 'rmq-messages',
    label: 'RMQ Messages',
    Icon: ChatBubbleLeftRightIcon,
    IconActive: ChatBubbleLeftRightIcon,
    nonSuperUserOnly: true,
    action: 'openMessaging',
  },
];

const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  onOpenMessaging,
  onOpenWhatsApp,
  onOpenEmailThread,
}) => {
  const location = useLocation();
  const { isSuperUser } = useAdminRole();
  const newLeadsCount = useNewLeadsCount();
  const [showQuickActionsDropdown, setShowQuickActionsDropdown] = useState(false);
  const [isAltTheme, setIsAltTheme] = useState(() => document.documentElement.classList.contains('theme-alt'));

  useEffect(() => {
    const checkTheme = () => setIsAltTheme(document.documentElement.classList.contains('theme-alt'));
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const [dropdownBottom, setDropdownBottom] = useState('4.25rem');
  const quickActionsButtonRef = useRef<HTMLButtonElement>(null);
  const navBarRef = useRef<HTMLDivElement>(null);

  // Hide on full-width pages (contract, case-manager, reports, etc.)
  const pathname = location.pathname;
  const isHidden =
    pathname.includes('/contract') ||
    pathname.startsWith('/case-manager') ||
    pathname.startsWith('/reports') ||
    pathname.startsWith('/public-') ||
    pathname === '/login';

  const visibleItems = navItems.filter((item) => {
    if (item.superUserOnly) return isSuperUser;
    if ((item as { nonSuperUserOnly?: boolean }).nonSuperUserOnly) return !isSuperUser;
    return true;
  });

  // Close dropdown when clicking outside or on a navigation link
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const dropdownMenu = document.querySelector('[data-mobile-quick-actions-dropdown]');
      const clickedOutsideButton = !quickActionsButtonRef.current?.contains(target);
      const clickedOutsideMenu = !dropdownMenu?.contains(target);
      const isNavigationLink = target.tagName === 'A' || !!target.closest('a');
      if (showQuickActionsDropdown && ((clickedOutsideButton && clickedOutsideMenu) || isNavigationLink)) {
        setShowQuickActionsDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showQuickActionsDropdown]);

  // Close dropdown on route change
  useEffect(() => {
    setShowQuickActionsDropdown(false);
  }, [pathname]);

  // Compute dropdown position when it opens (above the nav bar)
  useEffect(() => {
    if (showQuickActionsDropdown && navBarRef.current) {
      const rect = navBarRef.current.getBoundingClientRect();
      setDropdownBottom(`${window.innerHeight - rect.top + 8}px`);
    }
  }, [showQuickActionsDropdown]);

  if (isHidden || visibleItems.length === 0) {
    return null;
  }

  // Split items: left half, center (Quick Actions), right half
  const midIndex = Math.ceil(visibleItems.length / 2);
  const leftItems = visibleItems.slice(0, midIndex);
  const rightItems = visibleItems.slice(midIndex);

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 w-full z-[40]"
      style={{ paddingBottom: 0 }}
    >
      <div
        ref={navBarRef}
        className="w-full min-w-0 rounded-t-2xl border-t border-x-0 border-b-0 border-white/50 dark:border-white/20 bg-white/90 dark:bg-base-300/90 backdrop-blur-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
        style={{
          paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex items-center justify-between py-1 px-2 gap-1">
          {leftItems.map((item) => {
            const actionItem = item as { action?: string };
            const isAction = !!actionItem.action;
            const isActive =
              !isAction && (pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path)));
            const IconComponent = isActive ? item.IconActive : item.Icon;
            const showCount = item.path === '/new-cases' && newLeadsCount > 0;
            const itemClass = `flex items-center justify-center min-w-[48px] py-2.5 px-2 rounded-full transition-all duration-200 relative ${
              isActive ? 'bg-primary/10 text-primary' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'
            }`;

            if (isAction && actionItem.action === 'openMessaging') {
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onOpenMessaging?.()}
                  className={itemClass}
                  title={item.label}
                >
                  <IconComponent className="w-7 h-7 transition-transform duration-200" />
                </button>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive: navActive }) =>
                  `flex items-center justify-center min-w-[48px] py-2.5 px-2 rounded-full transition-all duration-200 relative ${
                    navActive ? 'bg-primary/10 text-primary' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'
                  }`
                }
              >
                <span className="relative inline-flex">
                  <IconComponent className={`w-7 h-7 transition-transform duration-200 ${isActive ? 'scale-105' : ''}`} />
                  {showCount && (
                    <span className="absolute -top-0.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                      {newLeadsCount > 9 ? '9+' : newLeadsCount}
                    </span>
                  )}
                </span>
              </NavLink>
            );
          })}

          {/* Quick Actions - center */}
          <div className="flex flex-col items-center justify-center min-w-[40px] py-0.5 px-0.5 gap-0" data-quick-actions-dropdown>
            <button
              ref={quickActionsButtonRef}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowQuickActionsDropdown((v) => !v);
              }}
              className="flex items-center justify-center w-12 h-12 rounded-full text-white font-medium transition-all duration-300 active:scale-95 shadow-lg hover:opacity-90"
              style={{ backgroundColor: '#471CCA' }}
              title="Quick Actions"
            >
              <BoltIcon className="w-6 h-6" />
            </button>
          </div>

          {rightItems.map((item) => {
            const actionItem = item as { action?: string };
            const isAction = !!actionItem.action;
            const isActive =
              !isAction && (pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path)));
            const IconComponent = isActive ? item.IconActive : item.Icon;
            const showCount = item.path === '/new-cases' && newLeadsCount > 0;
            const itemClass = `flex items-center justify-center min-w-[48px] py-2.5 px-2 rounded-full transition-all duration-200 relative ${
              isActive ? 'bg-primary/10 text-primary' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'
            }`;

            if (isAction && actionItem.action === 'openMessaging') {
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => onOpenMessaging?.()}
                  className={itemClass}
                  title={item.label}
                >
                  <IconComponent className="w-7 h-7 transition-transform duration-200" />
                </button>
              );
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive: navActive }) =>
                  `flex items-center justify-center min-w-[48px] py-2.5 px-2 rounded-full transition-all duration-200 relative ${
                    navActive ? 'bg-primary/10 text-primary' : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'
                  }`
                }
              >
                <span className="relative inline-flex">
                  <IconComponent className={`w-7 h-7 transition-transform duration-200 ${isActive ? 'scale-105' : ''}`} />
                  {showCount && (
                    <span className="absolute -top-0.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                      {newLeadsCount > 9 ? '9+' : newLeadsCount}
                    </span>
                  )}
                </span>
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* Dropdown above the bar */}
      {showQuickActionsDropdown &&
        createPortal(
          <div
            className="fixed left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-sm w-auto min-w-[280px] bg-white dark:bg-base-100 rounded-2xl shadow-2xl border border-base-200 z-[9999] overflow-hidden py-2"
            data-mobile-quick-actions-dropdown
            style={{ bottom: dropdownBottom }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenMessaging?.();
              }}
              className="flex items-center gap-4 px-5 py-4 w-full text-left border-b border-base-200 hover:bg-base-200/50 active:bg-base-200/70 transition-colors"
            >
              <ChatBubbleLeftRightIcon className="w-6 h-6 text-gray-500 flex-shrink-0" />
              <span className="text-base font-medium">RMQ Messages</span>
            </button>
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenWhatsApp?.();
              }}
              className="flex items-center gap-4 px-5 py-4 w-full text-left border-b border-base-200 hover:bg-base-200/50 active:bg-base-200/70 transition-colors"
            >
              <FaWhatsapp className="w-6 h-6 text-green-500 flex-shrink-0" />
              <span className="text-base font-medium">WhatsApp</span>
            </button>
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenEmailThread?.();
              }}
              className="flex items-center gap-4 px-5 py-4 w-full text-left border-b border-base-200 hover:bg-base-200/50 active:bg-base-200/70 transition-colors"
            >
              <EnvelopeIcon className="w-6 h-6 text-gray-500 flex-shrink-0" />
              <span className="text-base font-medium">Email Thread</span>
            </button>
            <Link
              to="/handler-management"
              onClick={() => setShowQuickActionsDropdown(false)}
              className="flex items-center gap-4 px-5 py-4 w-full text-left hover:bg-base-200/50 active:bg-base-200/70 transition-colors"
            >
              <UserGroupIcon className="w-6 h-6 text-gray-500 flex-shrink-0" />
              <span className="text-base font-medium">Handler Management</span>
            </Link>
          </div>,
          document.body
        )}
    </nav>
  );
};

export default MobileBottomNav;
