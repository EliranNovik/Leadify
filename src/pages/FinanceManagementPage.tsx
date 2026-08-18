import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BanknotesIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  HomeIcon,
  PlusCircleIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline';
import { useAdminRole } from '../hooks/useAdminRole';
import { useExternalUser } from '../hooks/useExternalUser';
import { supabase } from '../lib/supabase';
import FinanceManagementSideRail from '../components/finance/FinanceManagementSideRail';
import FinanceManagementDashboard, {
  type FinanceHubTabId,
} from '../components/finance/FinanceManagementDashboard';
import FinanceCollectionTab from '../components/finance/FinanceCollectionTab';
import FinanceCollectionDueTab from '../components/finance/FinanceCollectionDueTab';
import FinanceSignedSalesTab from '../components/finance/FinanceSignedSalesTab';
import FinanceAllExpensesTab from '../components/finance/FinanceAllExpensesTab';
import FinanceExpensesTab from '../components/finance/FinanceExpensesTab';
import type { CollectionFinancesRailBridge } from '../components/finance/collectionFinancesRailBridge';
import {
  parseFinanceCollectionFocus,
  type FinanceCollectionFocusId,
} from '../lib/financeCollectionFocus';

type HubTab = FinanceHubTabId;

const ALL_HUB_TABS: Array<{
  id: HubTab;
  label: string;
  icon: React.ElementType;
  collectionOnly?: boolean;
  superuserOnly?: boolean;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: HomeIcon, collectionOnly: true },
  { id: 'collection', label: 'Collection', icon: BanknotesIcon, collectionOnly: true },
  { id: 'collection-due', label: 'Collection Due', icon: ClockIcon, collectionOnly: true },
  { id: 'signed', label: 'Signed', icon: ClipboardDocumentCheckIcon, collectionOnly: true },
  { id: 'expenses', label: 'All expenses', icon: ReceiptPercentIcon, superuserOnly: true },
  { id: 'expense-entry', label: 'Expenses', icon: PlusCircleIcon },
];

function parseHubTab(raw: string | null): HubTab {
  if (
    raw === 'dashboard' ||
    raw === 'collection' ||
    raw === 'collection-due' ||
    raw === 'signed' ||
    raw === 'expenses' ||
    raw === 'expense-entry'
  ) {
    return raw;
  }
  if (raw === 'signed-sales') return 'signed';
  if (raw === 'overview') return 'dashboard';
  if (raw === 'all-expenses') return 'expenses';
  return 'dashboard';
}

function isCollectionFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/**
 * Finance Management hub.
 * Expenses tab is open to all internal users.
 * Collection tabs: superuser or collection manager.
 * All expenses report: superuser only.
 */
const FinanceManagementPage: React.FC = () => {
  const { isSuperUser } = useAdminRole();
  const { isExternalUser, isLoading: isLoadingExternal } = useExternalUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = parseHubTab(searchParams.get('tab'));
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [collectionRail, setCollectionRail] = useState<CollectionFinancesRailBridge | null>(null);
  const [hasCollectionAccess, setHasCollectionAccess] = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadCollectionAccess = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) {
            setHasCollectionAccess(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        let { data: userData } = await supabase
          .from('users')
          .select('employee_id')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (!userData && user.email) {
          const { data: userByEmail } = await supabase
            .from('users')
            .select('employee_id')
            .eq('email', user.email)
            .maybeSingle();
          userData = userByEmail;
        }

        if (!userData?.employee_id) {
          if (!cancelled) {
            setHasCollectionAccess(false);
            setPermissionsLoaded(true);
          }
          return;
        }

        const { data: employeeData } = await supabase
          .from('tenants_employee')
          .select('is_collection')
          .eq('id', userData.employee_id)
          .maybeSingle();

        if (!cancelled) {
          setHasCollectionAccess(isCollectionFlag(employeeData?.is_collection));
          setPermissionsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setHasCollectionAccess(false);
          setPermissionsLoaded(true);
        }
      }
    };

    void loadCollectionAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  const canViewCollectionTabs = isSuperUser || hasCollectionAccess;
  const canViewAllExpenses = isSuperUser;
  const fallbackTab: HubTab = canViewCollectionTabs ? 'dashboard' : 'expense-entry';

  const hubTabs = useMemo(
    () =>
      ALL_HUB_TABS.filter((tab) => {
        if (tab.superuserOnly && !canViewAllExpenses) return false;
        if (tab.collectionOnly && !canViewCollectionTabs) return false;
        return true;
      }),
    [canViewAllExpenses, canViewCollectionTabs],
  );

  const allowedIds = useMemo(() => new Set(hubTabs.map((t) => t.id)), [hubTabs]);

  const hubTab: HubTab = allowedIds.has(requestedTab) ? requestedTab : fallbackTab;

  const setHubTab = useCallback(
    (tab: HubTab, focus?: FinanceCollectionFocusId) => {
      if (!allowedIds.has(tab)) return;
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
    [allowedIds, setSearchParams],
  );

  const focusPreset = parseFinanceCollectionFocus(searchParams.get('focus'));

  useEffect(() => {
    if (!permissionsLoaded) return;
    if (allowedIds.has(requestedTab)) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', fallbackTab);
        return next;
      },
      { replace: true },
    );
  }, [allowedIds, fallbackTab, permissionsLoaded, requestedTab, setSearchParams]);

  const refreshDashboard = useCallback(() => {
    setDashboardRefreshKey((k) => k + 1);
    if (canViewCollectionTabs) {
      if (hubTab !== 'dashboard') setHubTab('dashboard');
    } else {
      setHubTab('expense-entry');
    }
  }, [canViewCollectionTabs, hubTab, setHubTab]);

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

  if ((!permissionsLoaded && !isSuperUser) || isLoadingExternal) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <span className="loading loading-spinner loading-md text-blue-600" />
      </div>
    );
  }

  if (isExternalUser) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
          <p className="font-semibold text-gray-800">Access required</p>
          <p className="text-sm text-gray-500 mt-1">Finance Management is for internal users.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="finance-management-page-shell min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:flex">
      {sideRail}

      <div
        className={
          hubTab === 'collection'
            ? 'min-w-0 flex-1 space-y-4 px-3 py-4 md:px-5 md:py-5'
            : 'min-w-0 flex-1 space-y-5 px-4 py-6 md:px-6'
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

        {hubTab === 'dashboard' && canViewCollectionTabs && (
          <FinanceManagementDashboard
            onOpenTab={setHubTab}
            refreshKey={dashboardRefreshKey}
            canViewExpenses={canViewAllExpenses}
          />
        )}
        {hubTab === 'collection' && canViewCollectionTabs && (
          <FinanceCollectionTab
            onRailBridgeChange={handleCollectionRailChange}
            focusPreset={focusPreset}
          />
        )}
        {hubTab === 'collection-due' && canViewCollectionTabs && (
          <FinanceCollectionDueTab focusPreset={focusPreset} />
        )}
        {hubTab === 'signed' && canViewCollectionTabs && <FinanceSignedSalesTab />}
        {hubTab === 'expenses' && canViewAllExpenses && <FinanceAllExpensesTab />}
        {hubTab === 'expense-entry' && (
          <FinanceExpensesTab canManageRestrictedKinds={canViewCollectionTabs} />
        )}
      </div>
    </div>
  );
};

export default FinanceManagementPage;
