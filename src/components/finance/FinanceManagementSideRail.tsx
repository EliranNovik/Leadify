import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, CheckIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import type { CollectionFinancesRailBridge } from './collectionFinancesRailBridge';

export type FinanceSideRailTab = {
  id: string;
  label: string;
  icon: React.ElementType;
};

export type FinanceManagementSideRailProps = {
  tabs: FinanceSideRailTab[];
  activeTab: string;
  refreshing?: boolean;
  onSelectTab: (id: string) => void;
  onRefresh: () => void;
  /** Collection report actions when Collection tab is active. */
  collectionRail?: CollectionFinancesRailBridge | null;
};

const collapsedBadgeClass = (active = false) =>
  [
    'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-sm transition-all',
    active
      ? 'text-blue-600 ring-2 ring-blue-500/70'
      : 'text-gray-600 hover:shadow-md hover:text-gray-900',
  ].join(' ');

const expandedItemClass =
  'flex w-full items-center gap-2.5 rounded-full border-0 px-0.5 py-0.5 text-left transition-colors hover:bg-black/[0.04]';

const expandedRowClass = (_active = false) => expandedItemClass;

const FinanceManagementSideRail: React.FC<FinanceManagementSideRailProps> = ({
  tabs,
  activeTab,
  refreshing = false,
  onSelectTab,
  onRefresh,
  collectionRail = null,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);
  const showCollectionActions = activeTab === 'collection' && !!collectionRail;

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
      setShowSettings(false);
      collapseTimer.current = null;
    }, 160);
  };

  useEffect(() => () => clearCollapseTimer(), []);

  useEffect(() => {
    if (!showSettings) return;
    const onPointerDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showSettings]);

  useEffect(() => {
    setShowSettings(false);
  }, [activeTab]);

  return (
    <aside
      className="hidden lg:sticky lg:top-0 lg:z-30 lg:block lg:h-[calc(100dvh-3.5rem)] lg:w-[4.75rem] lg:shrink-0 lg:self-start"
      aria-label="Finance navigation"
    >
      <div
        className={[
          'absolute inset-y-0 left-0 z-40 flex h-full flex-col overflow-visible bg-[#f6f6f6] transition-[width] duration-200 ease-out',
          expanded ? 'w-52' : 'w-[4.75rem]',
        ].join(' ')}
        onMouseEnter={openRail}
        onMouseLeave={scheduleCloseRail}
      >
      <nav
        className={
          expanded
            ? 'flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-2 pt-4'
            : 'flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto px-2 pt-4'
        }
        aria-label="Finance tabs"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className={expanded ? expandedItemClass : collapsedBadgeClass(active)}
            >
              {expanded ? (
                <span className={collapsedBadgeClass(active)}>
                  <Icon className="h-7 w-7 shrink-0" />
                </span>
              ) : (
                <Icon className="h-7 w-7 shrink-0" />
              )}
              {expanded ? (
                <span className={`whitespace-nowrap text-sm font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`}>
                  {tab.label}
                </span>
              ) : null}
            </button>
          );
        })}

        {showCollectionActions ? (
          <>
            <div className={expanded ? 'my-1 border-t border-gray-300/60' : 'my-1 h-px w-8 bg-gray-300/80'} />
            {expanded ? (
              <p className="px-3 pb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                Collection
              </p>
            ) : null}
            {collectionRail.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                title={action.title}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
                className={`${
                  expanded ? expandedItemClass : collapsedBadgeClass()
                } disabled:cursor-not-allowed disabled:opacity-50 ${expanded ? '' : '[&>svg]:h-7 [&>svg]:w-7'}`}
              >
                {expanded ? (
                  <span className={`${collapsedBadgeClass()} [&>svg]:h-7 [&>svg]:w-7`}>{action.icon}</span>
                ) : (
                  action.icon
                )}
                {expanded ? (
                  <span className="whitespace-nowrap text-sm font-semibold text-gray-700">{action.label}</span>
                ) : null}
              </button>
            ))}
            {collectionRail.selectedLeadCount > 0 ? (
              expanded ? (
                <div
                  className="flex w-full items-center gap-2.5 px-0.5 py-0.5 text-blue-700"
                  title={`${collectionRail.selectedLeadCount} lead${collectionRail.selectedLeadCount === 1 ? '' : 's'} selected`}
                  aria-label={`${collectionRail.selectedLeadCount} leads selected`}
                >
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-blue-600 shadow-sm">
                    {collectionRail.selectedLeadCount}
                  </span>
                  <span className="text-sm font-semibold">Selected</span>
                </div>
              ) : (
                <div
                  className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white text-sm font-bold text-blue-600 shadow-sm"
                  title={`${collectionRail.selectedLeadCount} lead${collectionRail.selectedLeadCount === 1 ? '' : 's'} selected`}
                  aria-label={`${collectionRail.selectedLeadCount} leads selected`}
                >
                  {collectionRail.selectedLeadCount}
                </div>
              )
            ) : null}
          </>
        ) : null}
      </nav>

      <div className={`relative mt-auto p-2 ${expanded ? 'border-t border-gray-300/60' : ''}`} ref={settingsRef}>
        <div className={expanded ? '' : 'flex justify-center'}>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={
              expanded
                ? `${expandedRowClass(showSettings)} text-gray-500 hover:text-gray-800 ${showSettings ? 'text-gray-800' : ''}`
                : `inline-flex h-12 w-12 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-black/[0.06] hover:text-gray-800 ${
                    showSettings ? 'text-gray-800' : ''
                  }`
            }
            title="Settings"
            aria-label="Settings"
            aria-expanded={showSettings}
            aria-haspopup="menu"
          >
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center">
              <Cog6ToothIcon className="h-7 w-7 shrink-0" />
            </span>
            {expanded ? <span className="whitespace-nowrap text-sm font-semibold text-gray-700">Settings</span> : null}
          </button>
        </div>
        {showSettings && (
          <div
            role="menu"
            className={
              expanded
                ? 'absolute bottom-14 left-2 right-2 z-50 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 shadow-lg'
                : 'absolute bottom-4 left-full z-50 ml-2 w-56 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 shadow-lg'
            }
          >
            {showCollectionActions ? (
              collectionRail.settingsSections.map((block, blockIndex) => (
                <div key={block.title || `block-${blockIndex}`}>
                  {blockIndex > 0 && <div className="my-1 border-t border-gray-100" aria-hidden />}
                  {block.title ? (
                    <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {block.title}
                    </p>
                  ) : null}
                  {block.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => {
                          item.onClick();
                          if (typeof item.checked !== 'boolean') {
                            setShowSettings(false);
                          }
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-gray-500" />
                        <span className="flex-1">{item.label}</span>
                        {typeof item.checked === 'boolean' ? (
                          item.checked ? (
                            <CheckIcon className="h-4 w-4 shrink-0 text-blue-600" />
                          ) : (
                            <span className="h-4 w-4 shrink-0" aria-hidden />
                          )
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowSettings(false);
                  onRefresh();
                }}
                disabled={refreshing}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                {refreshing ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <ArrowPathIcon className="h-5 w-5 shrink-0" />
                )}
                Refresh dashboard
              </button>
            )}
          </div>
        )}
      </div>
      </div>
    </aside>
  );
};

export default FinanceManagementSideRail;
