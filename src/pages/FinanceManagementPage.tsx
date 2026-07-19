import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BanknotesIcon,
  ClockIcon,
  HomeIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline';
import { useAdminRole } from '../hooks/useAdminRole';
import FinanceManagementSideRail from '../components/finance/FinanceManagementSideRail';
import FinanceManagementDashboard, {
  type FinanceHubTabId,
} from '../components/finance/FinanceManagementDashboard';
import FinanceCollectionTab from '../components/finance/FinanceCollectionTab';
import FinanceCollectionDueTab from '../components/finance/FinanceCollectionDueTab';
import FinanceAllExpensesTab from '../components/finance/FinanceAllExpensesTab';
import type { CollectionFinancesRailBridge } from '../components/finance/collectionFinancesRailBridge';
import {
  parseFinanceCollectionFocus,
  type FinanceCollectionFocusId,
} from '../lib/financeCollectionFocus';

type HubTab = FinanceHubTabId;

const ALL_HUB_TABS: Array<{ id: HubTab; label: string; icon: React.ElementType; superuserOnly?: boolean }> = [
  { id: 'dashboard', label: 'Dashboard', icon: HomeIcon },
  { id: 'collection', label: 'Collection', icon: BanknotesIcon },
  { id: 'collection-due', label: 'Collection Due', icon: ClockIcon },
  { id: 'expenses', label: 'All expenses', icon: ReceiptPercentIcon, superuserOnly: true },
];

function parseHubTab(raw: string | null): HubTab {
  if (
    raw === 'dashboard' ||
    raw === 'collection' ||
    raw === 'collection-due' ||
    raw === 'expenses'
  ) {
    return raw;
  }
  // Back-compat aliases
  if (raw === 'overview') return 'dashboard';
  if (raw === 'all-expenses') return 'expenses';
  return 'dashboard';
}

/**
 * Finance Management hub — sidebar + tabs for finance dashboard and reports.
 * Superuser-only page; All Expenses is additionally gated as superuser-only.
 */
const FinanceManagementPage: React.FC = () => {
  const { isSuperUser } = useAdminRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = parseHubTab(searchParams.get('tab'));
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [collectionRail, setCollectionRail] = useState<CollectionFinancesRailBridge | null>(null);

  const hubTabs = useMemo(
    () => ALL_HUB_TABS.filter((tab) => !tab.superuserOnly || isSuperUser),
    [isSuperUser],
  );

  const hubTab: HubTab =
    requestedTab === 'expenses' && !isSuperUser ? 'dashboard' : requestedTab;

  const setHubTab = useCallback(
    (tab: HubTab, focus?: FinanceCollectionFocusId) => {
      if (tab === 'expenses' && !isSuperUser) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          if (focus) next.set('focus', focus);
          else next.delete('focus');
          return next;
        },
        { replace: true },
      );
    },
    [isSuperUser, setSearchParams],
  );

  const focusPreset = parseFinanceCollectionFocus(searchParams.get('focus'));

  // Bounce non-superusers away from the expenses deep-link.
  useEffect(() => {
    if (requestedTab !== 'expenses' || isSuperUser) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'dashboard');
        return next;
      },
      { replace: true },
    );
  }, [isSuperUser, requestedTab, setSearchParams]);

  const refreshDashboard = useCallback(() => {
    setDashboardRefreshKey((k) => k + 1);
    if (hubTab !== 'dashboard') setHubTab('dashboard');
  }, [hubTab, setHubTab]);

  const handleCollectionRailChange = useCallback((bridge: CollectionFinancesRailBridge | null) => {
    setCollectionRail(bridge);
  }, []);

  const sideRail = useMemo(
    () => (
      <FinanceManagementSideRail
        tabs={hubTabs}
        activeTab={hubTab}
        onSelectTab={(id) => setHubTab(id as HubTab)}
        onRefresh={refreshDashboard}
        collectionRail={hubTab === 'collection' ? collectionRail : null}
      />
    ),
    [collectionRail, hubTab, hubTabs, refreshDashboard, setHubTab],
  );

  if (!isSuperUser) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
          <p className="font-semibold text-gray-800">Superuser access required</p>
          <p className="text-sm text-gray-500 mt-1">Finance Management is limited to superusers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="finance-management-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-56">
      {sideRail}

      <div
        className={
          hubTab === 'collection'
            ? 'mx-auto w-full max-w-none space-y-4 px-3 py-4 md:px-5 md:py-5'
            : 'mx-auto w-full max-w-none space-y-5 px-4 py-6 md:px-8'
        }
      >
        <div
          role="tablist"
          className="flex flex-wrap gap-2 rounded-2xl bg-white border border-gray-200 p-2 shadow-sm lg:hidden"
        >
          {hubTabs.map((tab) => {
            const Icon = tab.icon;
            const active = hubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setHubTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {hubTab === 'dashboard' && (
          <FinanceManagementDashboard
            onOpenTab={setHubTab}
            refreshKey={dashboardRefreshKey}
            canViewExpenses
          />
        )}
        {hubTab === 'collection' && (
          <FinanceCollectionTab
            onRailBridgeChange={handleCollectionRailChange}
            focusPreset={focusPreset}
          />
        )}
        {hubTab === 'collection-due' && <FinanceCollectionDueTab focusPreset={focusPreset} />}
        {hubTab === 'expenses' && <FinanceAllExpensesTab />}
      </div>
    </div>
  );
};

export default FinanceManagementPage;
