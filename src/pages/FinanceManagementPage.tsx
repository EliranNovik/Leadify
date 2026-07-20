import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BanknotesIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  HomeIcon,
  ReceiptPercentIcon,
} from '@heroicons/react/24/outline';
import { useAdminRole } from '../hooks/useAdminRole';
import { supabase } from '../lib/supabase';
import FinanceManagementSideRail from '../components/finance/FinanceManagementSideRail';
import FinanceManagementDashboard, {
  type FinanceHubTabId,
} from '../components/finance/FinanceManagementDashboard';
import FinanceCollectionTab from '../components/finance/FinanceCollectionTab';
import FinanceCollectionDueTab from '../components/finance/FinanceCollectionDueTab';
import FinanceSignedSalesTab from '../components/finance/FinanceSignedSalesTab';
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
  { id: 'signed', label: 'Signed', icon: ClipboardDocumentCheckIcon },
  { id: 'expenses', label: 'All expenses', icon: ReceiptPercentIcon, superuserOnly: true },
];

function parseHubTab(raw: string | null): HubTab {
  if (
    raw === 'dashboard' ||
    raw === 'collection' ||
    raw === 'collection-due' ||
    raw === 'signed' ||
    raw === 'expenses'
  ) {
    return raw;
  }
  if (raw === 'signed-sales') return 'signed';
  // Back-compat aliases
  if (raw === 'overview') return 'dashboard';
  if (raw === 'all-expenses') return 'expenses';
  return 'dashboard';
}

function isCollectionFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/**
 * Finance Management hub — sidebar + tabs for finance dashboard and reports.
 * Open to superusers and collection managers (`is_collection`).
 * All Expenses remains superuser-only.
 */
const FinanceManagementPage: React.FC = () => {
  const { isSuperUser } = useAdminRole();
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

  const canAccessFinanceHub = isSuperUser || hasCollectionAccess;
  const canViewExpenses = isSuperUser;

  const hubTabs = useMemo(
    () => ALL_HUB_TABS.filter((tab) => !tab.superuserOnly || canViewExpenses),
    [canViewExpenses],
  );

  const hubTab: HubTab =
    requestedTab === 'expenses' && !canViewExpenses ? 'dashboard' : requestedTab;

  const setHubTab = useCallback(
    (tab: HubTab, focus?: FinanceCollectionFocusId) => {
      if (tab === 'expenses' && !canViewExpenses) return;
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
    [canViewExpenses, setSearchParams],
  );

  const focusPreset = parseFinanceCollectionFocus(searchParams.get('focus'));

  // Bounce non-superusers away from the expenses deep-link.
  useEffect(() => {
    if (requestedTab !== 'expenses' || canViewExpenses) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'dashboard');
        return next;
      },
      { replace: true },
    );
  }, [canViewExpenses, requestedTab, setSearchParams]);

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

  if (!permissionsLoaded && !isSuperUser) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <span className="loading loading-spinner loading-md text-blue-600" />
      </div>
    );
  }

  if (!canAccessFinanceHub) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#ececec] lg:pl-8 flex items-center justify-center">
        <div className="rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
          <p className="font-semibold text-gray-800">Access required</p>
          <p className="text-sm text-gray-500 mt-1">
            Finance Management is limited to superusers and collection managers.
          </p>
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
            canViewExpenses={canViewExpenses}
          />
        )}
        {hubTab === 'collection' && (
          <FinanceCollectionTab
            onRailBridgeChange={handleCollectionRailChange}
            focusPreset={focusPreset}
          />
        )}
        {hubTab === 'collection-due' && <FinanceCollectionDueTab focusPreset={focusPreset} />}
        {hubTab === 'signed' && <FinanceSignedSalesTab />}
        {hubTab === 'expenses' && canViewExpenses && <FinanceAllExpensesTab />}
      </div>
    </div>
  );
};

export default FinanceManagementPage;
