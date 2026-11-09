import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import {
  HANDLING_PIPELINE_TABS,
  MORE_HANDLING_PIPELINE_TABS,
  PIPELINE_TAB_LABELS,
  isMoreHandlingPipelineTab,
  type PipelineRoleTab,
} from './pipelineUi';

type TabCountMap = Partial<Record<PipelineRoleTab, number | null>>;

type Props = {
  activeTab: PipelineRoleTab;
  onSelect: (tab: PipelineRoleTab) => void;
  counts?: TabCountMap;
  blockedTabs?: PipelineRoleTab[];
};

const SALES_TABS: PipelineRoleTab[] = ['closer', 'scheduler', 'manager', 'helper', 'expert'];

const PipelineRoleTabs: React.FC<Props> = ({
  activeTab,
  onSelect,
  counts = {},
  blockedTabs = [],
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreActive = isMoreHandlingPipelineTab(activeTab);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const renderTab = (tab: PipelineRoleTab) => {
    const active = activeTab === tab;
    const count = counts[tab];
    const blocked = blockedTabs.includes(tab);
    return (
      <button
        key={tab}
        type="button"
        role="tab"
        aria-selected={active}
        className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
          active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
        } ${blocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        onClick={() => !blocked && onSelect(tab)}
        disabled={blocked}
      >
        {PIPELINE_TAB_LABELS[tab]}
        {count != null ? (
          <span className="ml-1.5 text-xs font-medium text-gray-400">{count}</span>
        ) : null}
      </button>
    );
  };

  const moreMenu = (
    <div className="relative" ref={moreRef}>
      <button
        type="button"
        className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
          moreActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
        }`}
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        title={moreActive ? PIPELINE_TAB_LABELS[activeTab] : 'More handling roles'}
        onClick={() => setMoreOpen((open) => !open)}
      >
        {moreActive ? PIPELINE_TAB_LABELS[activeTab] : 'More'}
        {moreActive && counts[activeTab] != null ? (
          <span className="ml-1.5 text-xs font-medium text-gray-400">{counts[activeTab]}</span>
        ) : null}
        <ChevronDownIcon className={`ml-1 h-3.5 w-3.5 ${moreOpen ? 'rotate-180' : ''}`} />
      </button>
      {moreOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[18rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
          {MORE_HANDLING_PIPELINE_TABS.map((item) => {
            const selected = activeTab === item.id;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  selected ? 'bg-gray-100 font-semibold text-gray-900' : 'text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => {
                  onSelect(item.id);
                  setMoreOpen(false);
                }}
              >
                <span>{item.label}</span>
                {count != null ? <span className="text-xs font-medium text-gray-400">{count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  const renderGroup = (title: string, tabs: PipelineRoleTab[], trailing?: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </p>
      <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-gray-200/70 p-1">
        {tabs.map((tab) => renderTab(tab))}
        {trailing}
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap items-end gap-5" role="tablist" aria-label="Pipeline role">
      {renderGroup('Sales', SALES_TABS)}
      {renderGroup('Handling', HANDLING_PIPELINE_TABS, moreMenu)}
    </div>
  );
};

export default PipelineRoleTabs;
export type { PipelineRoleTab };
