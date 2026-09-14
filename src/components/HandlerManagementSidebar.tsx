import React from 'react';
import { HomeIcon, UserGroupIcon, UserIcon } from '@heroicons/react/24/outline';

export type HandlerPageTab = 'dashboard' | 'handlers' | 'retention';

const TABS: Array<{
  id: HandlerPageTab;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: <HomeIcon className="h-7 w-7" /> },
  { id: 'handlers', label: 'Handlers', icon: <UserGroupIcon className="h-7 w-7" /> },
  { id: 'retention', label: 'Retention Handler', icon: <UserIcon className="h-7 w-7" /> },
];

type Props = {
  activeTab: HandlerPageTab;
  onChange: (tab: HandlerPageTab) => void;
};

export default function HandlerManagementSidebar({ activeTab, onChange }: Props) {
  return (
    <>
      <div className="hidden w-16 shrink-0 md:block" aria-hidden />
      <aside className="group/hm-sidebar fixed inset-y-0 left-0 z-[51] hidden h-[100dvh] w-16 flex-col overflow-hidden border-r border-gray-200 bg-[#f9fafb] transition-[width,box-shadow] duration-300 ease-out hover:w-56 hover:shadow-[8px_0_24px_rgba(15,23,42,0.08)] md:flex">
        <nav className="flex flex-1 flex-col gap-1 px-2.5 pt-[calc(env(safe-area-inset-top,0px)+5rem)] md:pt-20">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.label}
                onClick={() => onChange(tab.id)}
                className={`flex h-12 w-full items-center gap-3 overflow-hidden rounded-xl px-3 text-left text-sm font-semibold transition-colors duration-200 ${
                  active
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-gray-600 hover:bg-white/70 hover:text-gray-900'
                }`}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
                  {tab.icon}
                </span>
                <span className="min-w-0 truncate whitespace-nowrap opacity-0 transition-opacity duration-300 ease-out group-hover/hm-sidebar:opacity-100">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

export function HandlerManagementMobileTabs({ activeTab, onChange }: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl bg-gray-200 p-1 md:hidden">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              active ? 'bg-primary text-white shadow-sm' : 'text-gray-600'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
