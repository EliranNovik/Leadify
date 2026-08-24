import React from 'react';
import {
  PIPELINE_TAB_LABELS,
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
const HANDLING_TABS: PipelineRoleTab[] = ['handler', 'retention'];

const PipelineRoleTabs: React.FC<Props> = ({
  activeTab,
  onSelect,
  counts = {},
  blockedTabs = [],
}) => {
  const renderGroup = (title: string, tabs: PipelineRoleTab[]) => (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </p>
      <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-gray-200/70 p-1">
        {tabs.map((tab) => {
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
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap items-end gap-5" role="tablist" aria-label="Pipeline role">
      {renderGroup('Sales', SALES_TABS)}
      {renderGroup('Handling', HANDLING_TABS)}
    </div>
  );
};

export default PipelineRoleTabs;
export type { PipelineRoleTab };
