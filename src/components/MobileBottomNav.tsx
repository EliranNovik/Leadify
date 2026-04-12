import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  CalendarIcon,
  MagnifyingGlassIcon,
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
  DocumentChartBarIcon as DocumentChartBarIconSolid,
  FolderPlusIcon as FolderPlusIconSolid,
} from '@heroicons/react/24/solid';
import { FaWhatsapp } from 'react-icons/fa';
import { useAdminRole } from '../hooks/useAdminRole';
import { useNewLeadsCount } from '../hooks/useNewLeadsCount';

/**
 * Fixed mobile tab bar sits below app chrome. Modals/drawers/backdrops must use a **higher** z-index
 * (e.g. Tailwind `z-50` or `z-[100]`) so they overlay this bar.
 */
export const MOBILE_BOTTOM_NAV_Z_INDEX = 40;
/** Use at least this for any full-screen overlay/modal/drawer on mobile (above the bottom nav). */
export const MOBILE_OVERLAY_MIN_Z_INDEX = 50;

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
  const [dropdownBottom, setDropdownBottom] = useState('5rem');
  const quickActionsButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    setShowQuickActionsDropdown(false);
  }, [pathname]);

  useEffect(() => {
    if (showQuickActionsDropdown && navRef.current) {
      const rect = navRef.current.getBoundingClientRect();
      setDropdownBottom(`${window.innerHeight - rect.top + 8}px`);
    }
  }, [showQuickActionsDropdown]);

  if (isHidden || visibleItems.length === 0) {
    return null;
  }

  const renderNavItem = (item: (typeof navItems)[0]) => {
    const actionItem = item as { action?: string };
    const isAction = !!actionItem.action;
    const isActive =
      !isAction && (pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path)));
    const IconComponent = isActive ? item.IconActive : item.Icon;
    const showCount = item.path === '/new-cases' && newLeadsCount > 0;

    const baseClass =
      'flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 py-2 min-h-[48px] rounded-lg transition-colors active:opacity-90';

    if (isAction && actionItem.action === 'openMessaging') {
      return (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpenMessaging?.()}
          className={`${baseClass} text-base-content/70 hover:text-base-content hover:bg-base-content/5`}
          title={item.label}
          aria-label={item.label}
        >
          <IconComponent className="h-7 w-7 shrink-0" />
          <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">{item.label}</span>
        </button>
      );
    }

    return (
      <NavLink
        key={item.path}
        to={item.path}
        title={item.label}
        aria-label={item.label}
        className={({ isActive: navActive }) =>
          `${baseClass} ${navActive ? 'text-primary bg-primary/10' : 'text-base-content/70 hover:text-base-content hover:bg-base-content/5'}`
        }
      >
        <span className="relative inline-flex shrink-0">
          <IconComponent className={`h-7 w-7 ${isActive ? 'scale-105' : ''}`} />
          {showCount && (
            <span className="absolute -top-0.5 -right-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white">
              {newLeadsCount > 9 ? '9+' : newLeadsCount}
            </span>
          )}
        </span>
        <span className="text-[10px] font-medium leading-none truncate max-w-full px-0.5">{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav
      ref={navRef}
      data-mobile-bottom-nav
      className="md:hidden fixed bottom-0 left-0 right-0 border-0 shadow-none bg-base-100 pointer-events-auto"
      style={{
        zIndex: MOBILE_BOTTOM_NAV_Z_INDEX,
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="flex items-stretch justify-around gap-0 px-1 pt-1">
        {visibleItems.map((item) => renderNavItem(item))}
        <button
          ref={quickActionsButtonRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowQuickActionsDropdown((v) => !v);
          }}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 min-h-[48px] rounded-lg transition-colors active:opacity-90 ${
            showQuickActionsDropdown ? 'text-primary bg-primary/10' : 'text-base-content/70 hover:text-base-content hover:bg-base-content/5'
          }`}
          title="Quick actions"
          aria-label="Quick actions"
          aria-expanded={showQuickActionsDropdown}
        >
          <BoltIcon className="h-7 w-7 shrink-0" strokeWidth={1.75} />
          <span className="text-[10px] font-medium leading-none">More</span>
        </button>
      </div>

      {showQuickActionsDropdown &&
        createPortal(
          <div
            className="fixed left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-sm w-auto min-w-[280px] rounded-2xl border border-base-200 bg-base-100 py-2 shadow-2xl overflow-hidden"
            data-mobile-quick-actions-dropdown
            style={{ bottom: dropdownBottom, zIndex: MOBILE_OVERLAY_MIN_Z_INDEX }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenMessaging?.();
              }}
              className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
            >
              <ChatBubbleLeftRightIcon className="h-6 w-6 shrink-0 text-gray-500" />
              <span className="text-base font-medium">RMQ Messages</span>
            </button>
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenWhatsApp?.();
              }}
              className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
            >
              <FaWhatsapp className="h-6 w-6 shrink-0 text-green-500" />
              <span className="text-base font-medium">WhatsApp</span>
            </button>
            <button
              onClick={() => {
                setShowQuickActionsDropdown(false);
                onOpenEmailThread?.();
              }}
              className="flex w-full items-center gap-4 border-b border-base-200 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
            >
              <EnvelopeIcon className="h-6 w-6 shrink-0 text-gray-500" />
              <span className="text-base font-medium">Email Thread</span>
            </button>
            <Link
              to="/handler-management"
              onClick={() => setShowQuickActionsDropdown(false)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-base-200/50 active:bg-base-200/70"
            >
              <UserGroupIcon className="h-6 w-6 shrink-0 text-gray-500" />
              <span className="text-base font-medium">Handler Management</span>
            </Link>
          </div>,
          document.body
        )}
    </nav>
  );
};

export default MobileBottomNav;
