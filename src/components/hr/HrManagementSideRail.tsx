import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  BuildingOffice2Icon,
  Cog6ToothIcon,
  PlusIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import { FaFileExcel } from 'react-icons/fa';

export type HrSideRailTab = {
  id: string;
  label: string;
  icon: React.ElementType;
};

export type HrManagementSideRailProps = {
  tabs: HrSideRailTab[];
  activeTab: string;
  pendingApprovals?: number;
  hoursExporting?: boolean;
  onSelectTab: (id: string) => void;
  onAddEmployee: () => void;
  onAddUser: () => void;
  onRefresh: () => void;
  onExportHours: () => void;
  onOpenOrganization: () => void;
  onOpenAdmin: () => void;
};

const rowClass = (active = false) =>
  [
    'flex h-11 w-full items-center gap-3 rounded-xl border-0 px-3 text-left transition-colors',
    active
      ? 'bg-emerald-600 text-white hover:bg-emerald-600'
      : 'text-gray-600 hover:bg-gray-200/80',
  ].join(' ');

const HrManagementSideRail: React.FC<HrManagementSideRailProps> = ({
  tabs,
  activeTab,
  pendingApprovals = 0,
  hoursExporting = false,
  onSelectTab,
  onAddEmployee,
  onAddUser,
  onRefresh,
  onExportHours,
  onOpenOrganization,
  onOpenAdmin,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

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

  return (
    <aside
      className="hidden lg:fixed lg:left-0 lg:top-14 lg:bottom-0 lg:z-40 lg:flex lg:w-56 lg:flex-col lg:border-r lg:border-gray-200 lg:bg-white lg:overflow-visible"
      aria-label="HR navigation"
    >
      <div className="flex w-full flex-col gap-1 px-2 pt-4">
        <button
          type="button"
          onClick={onAddEmployee}
          title="Add employee"
          aria-label="Add employee"
          className={rowClass()}
        >
          <PlusIcon className="h-6 w-6 shrink-0 text-emerald-600" />
          <span className="whitespace-nowrap text-sm font-semibold">Add employee</span>
        </button>
        <button
          type="button"
          onClick={onAddUser}
          title="Add user"
          aria-label="Add user"
          className={rowClass()}
        >
          <UserPlusIcon className="h-6 w-6 shrink-0" />
          <span className="whitespace-nowrap text-sm font-semibold">Add user</span>
        </button>
      </div>

      <div className="mx-3 my-3 border-t border-gray-200" />

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2" aria-label="HR tabs">
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
              {tab.id === 'approvals' && pendingApprovals > 0 && (
                <span
                  className={[
                    'ml-auto inline-flex min-h-7 min-w-7 items-center justify-center rounded-full px-2.5 text-sm font-bold leading-none',
                    active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-800',
                  ].join(' ')}
                >
                  {pendingApprovals > 99 ? '99+' : pendingApprovals}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="relative px-2 pb-4" ref={settingsRef}>
        <button
          type="button"
          onClick={() => setShowSettings((prev) => !prev)}
          title="Settings"
          aria-label="Settings"
          aria-expanded={showSettings}
          className={rowClass(showSettings)}
        >
          <Cog6ToothIcon className="h-6 w-6 shrink-0" />
          <span className="whitespace-nowrap text-sm font-semibold">Settings</span>
        </button>
        {showSettings && (
          <div
            className="absolute bottom-full left-2 right-2 z-[320] mb-2 min-w-[240px] rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg"
            role="menu"
          >
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Settings
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowSettings(false);
                onRefresh();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
            >
              <ArrowPathIcon className="h-5 w-5 flex-shrink-0 text-gray-500" />
              <span className="whitespace-nowrap text-sm text-gray-800">Refresh data</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={hoursExporting}
              onClick={() => {
                setShowSettings(false);
                onExportHours();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaFileExcel className="h-5 w-5 flex-shrink-0 text-emerald-700" />
              <span className="whitespace-nowrap text-sm text-gray-800">
                {hoursExporting ? 'Exporting…' : 'Export working hours'}
              </span>
            </button>
            <div className="my-1 border-t border-gray-200" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowSettings(false);
                onOpenOrganization();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
            >
              <BuildingOffice2Icon className="h-5 w-5 flex-shrink-0 text-gray-500" />
              <span className="whitespace-nowrap text-sm text-gray-800">Organization</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowSettings(false);
                onOpenAdmin();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-100"
            >
              <Cog6ToothIcon className="h-5 w-5 flex-shrink-0 text-gray-500" />
              <span className="whitespace-nowrap text-sm text-gray-800">Admin</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export default HrManagementSideRail;
