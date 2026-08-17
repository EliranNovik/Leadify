import React, { useEffect, useRef, useState } from 'react';
import {
  Bars3BottomLeftIcon,
  CheckCircleIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  Squares2X2Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

/** Collapsed rail width — keep in sync with Sidebar docked `left-*` and ClientHeader rail pad. */
export const CLIENT_DETAIL_NAV_RAIL_COLLAPSED_WIDTH = '4.75rem';
export const CLIENT_DETAIL_NAV_RAIL_WIDTH_CLASS = 'w-[4.75rem]';
export const CLIENT_DETAIL_NAV_RAIL_LEFT_CLASS = 'left-[4.75rem]';
export const CLIENT_DETAIL_NAV_PL_CLASS = 'md:pl-[4.75rem]';
export const CLIENT_DETAIL_DOCKED_SIDEBAR_WIDTH_CLASS = 'w-64';
/** Collapsed rail (4.75rem) + docked app sidebar (16rem). */
export const CLIENT_DETAIL_NAV_WITH_APP_PL_CLASS = 'md:pl-[20.75rem]';
export const CLIENT_DETAIL_NAV_WITH_APP_LEFT_CLASS = 'left-[20.75rem]';

export type ClientDetailNavTab = {
  id: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  badge?: number;
};

export type ClientDetailNavLeadActions = {
  onCreateSubLead: () => void;
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

/**
 * Client tab rail — collapsed icon column, hover opens one menu card.
 * Icons stay in the left column; labels appear beside them on a single surface.
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
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number | null>(null);

  const clearCollapseTimer = () => {
    if (collapseTimer.current != null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  };

  const openRail = () => {
    clearCollapseTimer();
    setExpanded(true);
  };

  const scheduleCloseRail = () => {
    clearCollapseTimer();
    collapseTimer.current = window.setTimeout(() => {
      setExpanded(false);
      collapseTimer.current = null;
    }, 160);
  };

  useEffect(() => () => clearCollapseTimer(), []);

  const renderBadgeIcon = (
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>,
    extraClass = '',
    badge?: number,
  ) => (
    <span className="relative inline-flex">
      <Icon className={`h-5 w-5 shrink-0 ${extraClass}`} />
      {badge ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-0.5 text-[9px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </span>
  );

  const footerBtnClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800';

  return (
    <aside
      className="hidden md:block md:fixed md:bottom-0 md:left-0 md:z-30 md:w-[4.75rem] md:overflow-visible"
      style={{ top: 'var(--client-detail-nav-top, 7.25rem)' }}
      aria-label="Client sections"
    >
      <div
        className={[
          'absolute left-2 top-0 z-40 flex h-fit flex-col overflow-visible transition-[width,background-color,box-shadow] duration-200 ease-out',
          expanded
            ? 'w-56 rounded-2xl bg-white py-2 shadow-[0_12px_40px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.04]'
            : 'w-[3.75rem] rounded-2xl bg-transparent py-1',
        ].join(' ')}
        onMouseEnter={openRail}
        onMouseLeave={scheduleCloseRail}
      >
        <nav
          className={
            expanded
              ? 'flex h-fit flex-col gap-0.5 px-1.5'
              : 'flex h-fit flex-col items-center gap-1 px-1'
          }
          aria-label="Client tabs"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const badge = tab.id === 'interactions' ? tab.badge : undefined;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                onMouseEnter={() => onPrefetchTab?.(tab.id)}
                title={tab.label}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex h-10 shrink-0 items-center border-0 text-left transition-colors',
                  expanded
                    ? 'w-full gap-3 rounded-xl px-1.5'
                    : 'w-10 justify-center rounded-full',
                  active
                    ? expanded
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-white text-blue-600 shadow-sm'
                    : expanded
                      ? 'bg-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      : 'bg-transparent text-gray-500 hover:bg-white hover:text-gray-800',
                ].join(' ')}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center">
                  {renderBadgeIcon(Icon, '', badge)}
                </span>
                {expanded ? (
                  <span className="saira-regular min-w-0 flex-1 truncate pr-2 text-[13px] font-medium tracking-tight">
                    {tab.label}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="absolute bottom-2 left-0 z-40 flex w-[4.75rem] justify-center">
        <div className="flex flex-col items-center gap-1">
          {leadActions ? (
            <div className="tooltip tooltip-right z-50" data-tip="Add sublead">
              <button
                type="button"
                onClick={() => void leadActions.onCreateSubLead()}
                className={footerBtnClass}
                aria-label="Add Sublead"
              >
                <Squares2X2Icon className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          {leadActions ? (
            <div
              className="tooltip tooltip-right z-50"
              data-tip={leadActions.isUnactivated ? 'Activate case' : 'Deactivate / spam'}
            >
              <button
                type="button"
                onClick={() => leadActions.onDeactivateOrActivate()}
                className={`${footerBtnClass} ${
                  leadActions.isUnactivated
                    ? 'text-emerald-600 hover:text-emerald-700'
                    : 'text-red-500 hover:text-red-600'
                }`}
                aria-label={leadActions.isUnactivated ? 'Activate' : 'Deactivate / Spam'}
              >
                {leadActions.isUnactivated ? (
                  <CheckCircleIcon className="h-5 w-5" />
                ) : (
                  <NoSymbolIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          ) : null}
          {leadActions ? (
            <div className="tooltip tooltip-right z-50" data-tip="Edit details">
              <button
                type="button"
                onClick={() => leadActions.onEditDetails()}
                className={footerBtnClass}
                aria-label="Edit Details"
              >
                <PencilSquareIcon className="h-5 w-5" />
              </button>
            </div>
          ) : null}
          <div
            className="tooltip tooltip-right z-50"
            data-tip={appNavOpen ? 'Close menu' : 'Open menu'}
          >
            <button
              type="button"
              onClick={onToggleAppNav}
              data-clients-app-nav-toggle
              className={`${footerBtnClass} ${appNavOpen ? 'text-gray-800' : ''}`}
              aria-label={appNavOpen ? 'Close app navigation' : 'Open app navigation'}
              aria-expanded={appNavOpen}
            >
              {appNavOpen ? <XMarkIcon className="h-5 w-5" /> : <Bars3BottomLeftIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default React.memo(ClientDetailNavRail);
