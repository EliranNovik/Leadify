import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bars3BottomLeftIcon,
  CheckCircleIcon,
  HomeIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  StarIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';

/** Rail width — keep in sync with Sidebar docked `left-*` and ClientHeader rail pad. */
export const CLIENT_DETAIL_NAV_RAIL_WIDTH_CLASS = 'w-40';
export const CLIENT_DETAIL_NAV_RAIL_LEFT_CLASS = 'left-40';
export const CLIENT_DETAIL_NAV_PL_CLASS = 'md:pl-40';
export const CLIENT_DETAIL_DOCKED_SIDEBAR_WIDTH_CLASS = 'w-64';
/** Rail (10rem) + docked app sidebar (16rem). */
export const CLIENT_DETAIL_NAV_WITH_APP_PL_CLASS = 'md:pl-[26rem]';
export const CLIENT_DETAIL_NAV_WITH_APP_LEFT_CLASS = 'left-[26rem]';

export type ClientDetailNavTab = {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
};

export type ClientDetailNavLeadActions = {
  onCreateSubLead: () => void;
  onToggleHighlights: () => void | Promise<void>;
  isInHighlights: boolean;
  onEditDetails: () => void;
  onDeactivateOrActivate: () => void;
  isUnactivated: boolean;
};

type ClientDetailNavRailProps = {
  tabs: ClientDetailNavTab[];
  activeTab: string;
  onSelectTab: (tabId: string) => void;
  onPrefetchTab?: (tabId: string) => void;
  appNavOpen: boolean;
  onToggleAppNav: () => void;
  leadActions?: ClientDetailNavLeadActions;
};

const railActionBtnClass =
  'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors';

/**
 * Fixed grey tab rail — top edge flush under the white client header band
 * (`--client-detail-nav-top` measured from `.client-header-top-band`).
 */
const ClientDetailNavRail: React.FC<ClientDetailNavRailProps> = ({
  tabs,
  activeTab,
  onSelectTab,
  onPrefetchTab,
  appNavOpen,
  onToggleAppNav,
  leadActions,
}) => {
  return (
    <aside
      className={`hidden md:flex ${CLIENT_DETAIL_NAV_RAIL_WIDTH_CLASS} fixed bottom-0 left-0 z-30 flex-col border-r border-gray-300/80 bg-gray-200 dark:border-base-content/10 dark:bg-base-300`}
      style={{ top: 'var(--client-detail-nav-top, 3rem)' }}
      aria-label="Client sections"
    >
      <nav className="hide-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-2.5 pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              onMouseEnter={() => onPrefetchTab?.(tab.id)}
              className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-white font-semibold text-gray-900 shadow-sm dark:bg-base-100 dark:text-base-content'
                  : 'font-medium text-gray-600 hover:bg-white/55 hover:text-gray-900 dark:text-base-content/70 dark:hover:bg-base-100/50 dark:hover:text-base-content'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-gray-700 dark:bg-base-content"
                  aria-hidden
                />
              )}
              <span className="relative inline-flex shrink-0">
                <Icon
                  className={`h-5 w-5 ${
                    isActive
                      ? 'text-gray-800 dark:text-base-content'
                      : 'text-gray-500 dark:text-base-content/60'
                  }`}
                />
                {tab.id === 'interactions' && tab.badge ? (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gray-700 px-0.5 text-[10px] font-bold text-white dark:bg-base-content dark:text-base-300">
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
              </span>
              <span className="saira-regular truncate">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {leadActions ? (
        <div className="flex shrink-0 flex-col gap-0.5 px-2 pt-2">
          <button
            type="button"
            onClick={() => void leadActions.onCreateSubLead()}
            className={`${railActionBtnClass} text-gray-600 hover:bg-white/55 hover:text-gray-900 dark:text-base-content/70 dark:hover:bg-base-100/50 dark:hover:text-base-content`}
            title="Create Sub-Lead"
          >
            <Squares2X2Icon className="h-5 w-5 shrink-0 text-gray-500 dark:text-base-content/60" />
            <span className="saira-regular truncate">Add Sublead</span>
          </button>
          <button
            type="button"
            onClick={() => void leadActions.onToggleHighlights()}
            className={`${railActionBtnClass} ${
              leadActions.isInHighlights
                ? 'text-purple-700 hover:bg-white/55 dark:text-purple-300 dark:hover:bg-base-100/50'
                : 'text-gray-600 hover:bg-white/55 hover:text-gray-900 dark:text-base-content/70 dark:hover:bg-base-100/50 dark:hover:text-base-content'
            }`}
            title={leadActions.isInHighlights ? 'Remove from Highlights' : 'Add to Highlights'}
          >
            {leadActions.isInHighlights ? (
              <StarIconSolid className="h-5 w-5 shrink-0 text-purple-600 dark:text-purple-300" />
            ) : (
              <StarIcon className="h-5 w-5 shrink-0 text-gray-500 dark:text-base-content/60" />
            )}
            <span className="saira-regular truncate">
              {leadActions.isInHighlights ? 'In Highlights' : 'Add to Highlights'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => leadActions.onDeactivateOrActivate()}
            className={`${railActionBtnClass} ${
              leadActions.isUnactivated
                ? 'text-emerald-700 hover:bg-white/55 dark:text-emerald-300 dark:hover:bg-base-100/50'
                : 'text-red-600 hover:bg-white/55 dark:text-red-400 dark:hover:bg-base-100/50'
            }`}
            title={leadActions.isUnactivated ? 'Activate Case' : 'Deactivate / Spam'}
          >
            {leadActions.isUnactivated ? (
              <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
            ) : (
              <NoSymbolIcon className="h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
            )}
            <span className="saira-regular truncate">
              {leadActions.isUnactivated ? 'Activate' : 'Deactivate / Spam'}
            </span>
          </button>
        </div>
      ) : null}

      {/* Edit + Dashboard + app menu at bottom of rail */}
      <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-gray-300/70 px-2 py-2.5 dark:border-base-content/10">
        {leadActions ? (
          <button
            type="button"
            onClick={() => leadActions.onEditDetails()}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-400/70 bg-white text-gray-700 shadow-sm transition-colors hover:border-gray-500 hover:bg-gray-50 dark:border-base-content/20 dark:bg-base-100 dark:text-base-content dark:hover:bg-base-200"
            aria-label="Edit Details"
            title="Edit Details"
          >
            <PencilSquareIcon className="h-5 w-5" />
          </button>
        ) : null}
        <Link
          to="/"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-400/70 bg-white text-gray-700 shadow-sm transition-colors hover:border-gray-500 hover:bg-gray-50 dark:border-base-content/20 dark:bg-base-100 dark:text-base-content dark:hover:bg-base-200"
          aria-label="Dashboard"
          title="Dashboard"
        >
          <HomeIcon className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={onToggleAppNav}
          data-clients-app-nav-toggle
          className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
            appNavOpen
              ? 'border-gray-500 bg-gray-700 text-white shadow-md dark:border-base-content/40 dark:bg-base-100 dark:text-base-content'
              : 'border-gray-400/70 bg-white text-gray-700 shadow-sm hover:border-gray-500 hover:bg-gray-50 dark:border-base-content/20 dark:bg-base-100 dark:text-base-content dark:hover:bg-base-200'
          }`}
          aria-label={appNavOpen ? 'Close app navigation' : 'Open app navigation'}
          aria-expanded={appNavOpen}
          title={appNavOpen ? 'Close menu' : 'Open menu'}
        >
          {appNavOpen ? (
            <XMarkIcon className="h-5 w-5" />
          ) : (
            <Bars3BottomLeftIcon className="h-5 w-5" />
          )}
        </button>
      </div>
    </aside>
  );
};

export default React.memo(ClientDetailNavRail);
