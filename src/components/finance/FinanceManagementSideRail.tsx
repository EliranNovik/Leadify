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

const rowClass = (active = false) =>
  [
    'flex h-11 w-full items-center gap-3 rounded-xl border-0 px-3 text-left transition-colors',
    active
      ? 'bg-blue-600 text-white hover:bg-blue-600'
      : 'text-gray-600 hover:bg-gray-200/80',
  ].join(' ');

const FinanceManagementSideRail: React.FC<FinanceManagementSideRailProps> = ({
  tabs,
  activeTab,
  refreshing = false,
  onSelectTab,
  onRefresh,
  collectionRail = null,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const showCollectionActions = activeTab === 'collection' && !!collectionRail;

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
      className="hidden lg:fixed lg:left-0 lg:top-14 lg:bottom-0 lg:z-40 lg:flex lg:w-56 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white lg:overflow-visible"
      aria-label="Finance navigation"
    >
      <div className="px-4 pt-5 pb-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">Finance</p>
        <p className="mt-1 text-sm font-semibold text-gray-800">Management</p>
      </div>

      <div className="mx-3 mb-3 border-t border-gray-200" />

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2" aria-label="Finance tabs">
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
              className={rowClass(active)}
            >
              <Icon className="h-6 w-6 shrink-0" />
              <span className="whitespace-nowrap text-sm font-semibold">{tab.label}</span>
            </button>
          );
        })}

        {showCollectionActions ? (
          <>
            <div className="my-2 border-t border-gray-200" />
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              Collection
            </p>
            {collectionRail.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                title={action.title}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={action.onClick}
                className={`${rowClass()} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {action.icon}
                <span className="whitespace-nowrap text-sm font-semibold">{action.label}</span>
              </button>
            ))}
            {collectionRail.selectedLeadCount > 0 ? (
              <div
                className="mt-1 flex items-center gap-3 rounded-xl bg-blue-600/10 px-3 py-2 text-blue-700"
                title={`${collectionRail.selectedLeadCount} lead${collectionRail.selectedLeadCount === 1 ? '' : 's'} selected`}
                aria-label={`${collectionRail.selectedLeadCount} leads selected`}
              >
                <span className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg bg-blue-600 px-2 text-sm font-bold text-white">
                  {collectionRail.selectedLeadCount}
                </span>
                <span className="text-sm font-semibold">Selected</span>
              </div>
            ) : null}
          </>
        ) : null}
      </nav>

      <div className="relative mt-auto border-t border-gray-200 p-2" ref={settingsRef}>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className={rowClass(showSettings)}
          title="Settings"
          aria-label="Settings"
          aria-expanded={showSettings}
          aria-haspopup="menu"
        >
          <Cog6ToothIcon className="h-6 w-6 shrink-0" />
          <span className="whitespace-nowrap text-sm font-semibold">Settings</span>
        </button>
        {showSettings && (
          <div
            role="menu"
            className="absolute bottom-14 left-2 right-2 z-50 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
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
                          // Keep menu open for column/filter toggles (checked items).
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
    </aside>
  );
};

export default FinanceManagementSideRail;
