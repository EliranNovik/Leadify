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

/**
 * Under this height the vertical footer stack (~10rem) and the expanded tab list (~26rem for
 * the full 9 tabs, below a 7.25rem rail offset) stop fitting together, so the actions lay out
 * horizontally along the bottom and hand that space back to the tabs.
 */
const SHORT_RAIL_VIEWPORT_QUERY = '(max-height: 820px)';

/**
 * Clears the horizontal action bar (2.75rem tall, 0.5rem off the bottom) so the docked app nav
 * opens from just above it instead of covering it.
 */
export const CLIENT_DETAIL_NAV_ACTIONS_CLEARANCE_CLASS = 'bottom-[3.75rem]';

export const useShortRailViewport = () => {
  const [isShort, setIsShort] = useState(
    () => window.matchMedia(SHORT_RAIL_VIEWPORT_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(SHORT_RAIL_VIEWPORT_QUERY);
    const sync = () => setIsShort(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isShort;
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
 * Client tab rail — collapsed shows only the active tab icon at the top;
 * hover (or focus) opens the existing menu card with all sections.
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
  const horizontalActions = useShortRailViewport();
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

  const collapsedIconBtnClass = 'h-12 w-12';
  const renderBadgeIcon = (
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>,
    extraClass = '',
    badge?: number,
  ) => (
    <span className="relative inline-flex">
      <Icon className={`shrink-0 ${extraClass}`} />
      {badge ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-0.5 text-[9px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </span>
  );

  const footerBtnClass =
    'inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800';
  const footerTooltipClass = horizontalActions
    ? 'tooltip tooltip-top z-50'
    : 'tooltip tooltip-right z-50';

  return (
    // Flex column rather than two absolutely-positioned children: the tab card and the
    // footer buttons used to be independently pinned to top/bottom at the same z-index, so on
    // a short viewport the card grew underneath the footer and the footer painted over it.
    <aside
      className="hidden md:fixed md:bottom-0 md:left-0 md:z-30 md:flex md:w-[4.75rem] md:flex-col md:overflow-visible"
      style={{ top: 'var(--client-detail-nav-top, 7.25rem)' }}
      aria-label="Client sections"
    >
      <div
        className={[
          'relative z-40 flex min-h-0 flex-col overflow-visible',
          expanded ? 'w-[15.5rem] flex-1 pb-2 pt-0' : 'h-[22rem] w-[4.75rem] pt-0',
        ].join(' ')}
        onMouseEnter={openRail}
        onMouseLeave={scheduleCloseRail}
        onFocusCapture={openRail}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            scheduleCloseRail();
          }
        }}
      >
        <div
          className={[
            'flex min-h-0 flex-col transition-[width,background-color,box-shadow] duration-200 ease-out',
            expanded
              ? 'ml-2 w-56 rounded-2xl bg-white py-2 shadow-[0_12px_40px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.04]'
              : 'ml-2 w-12 rounded-2xl bg-transparent py-0',
          ].join(' ')}
        >
          <nav
            className={
              expanded
                ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1.5 py-2'
                : 'flex h-fit flex-col items-center'
            }
            aria-label="Client tabs"
            aria-expanded={expanded}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              const badge = tab.id === 'interactions' ? tab.badge : undefined;
              const collapsedHidden = !expanded && !active;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  onMouseEnter={() => onPrefetchTab?.(tab.id)}
                  title={tab.label}
                  aria-label={tab.label}
                  aria-current={active ? 'page' : undefined}
                  aria-hidden={collapsedHidden || undefined}
                  tabIndex={collapsedHidden ? -1 : undefined}
                  className={[
                    'flex shrink-0 items-center border-0 text-left transition-colors',
                    collapsedHidden ? 'hidden' : '',
                    expanded
                      ? 'h-9 w-full gap-2.5 rounded-lg px-1.5'
                      : `${collapsedIconBtnClass} justify-center rounded-full`,
                    active
                      ? expanded
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-white text-blue-600 shadow-sm'
                      : 'bg-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  ].join(' ')}
                >
                  <span
                    className={`flex shrink-0 items-center justify-center ${
                      expanded ? 'h-9 w-9' : collapsedIconBtnClass
                    }`}
                  >
                    {renderBadgeIcon(Icon, 'h-7 w-7', badge)}
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
      </div>

      <div
        className={[
          'z-40 mt-auto flex shrink-0 pb-2',
          horizontalActions ? 'w-max pl-2' : 'w-[4.75rem] justify-center',
        ].join(' ')}
      >
        <div
          className={[
            'flex items-center gap-1',
            // The row is wider than the 4.75rem rail, so it overflows onto the page; the pill
            // keeps the icons legible against whatever content sits behind it.
            horizontalActions
              ? 'flex-row rounded-full bg-white px-1.5 py-1 shadow-[0_6px_20px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.04]'
              : 'flex-col',
          ].join(' ')}
        >
          {leadActions ? (
            <div className={footerTooltipClass} data-tip="Add sublead">
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
              className={footerTooltipClass}
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
            <div className={footerTooltipClass} data-tip="Edit details">
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
            className={footerTooltipClass}
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
