import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PortalLayout from './PortalLayout';
import { usePortalSession } from './usePortalSession';
import PortalDashboardTab from './tabs/PortalDashboardTab';
import PortalStagesTab from './tabs/PortalStagesTab';
import PortalFinanceTab from './tabs/PortalFinanceTab';
import PortalDocumentsTab from './tabs/PortalDocumentsTab';
import PortalContactsTab from './tabs/PortalContactsTab';
import PortalMeetingsTab from './tabs/PortalMeetingsTab';
import PortalTabPageTurn from './components/PortalTabPageTurn';
import { PortalTabDataProvider, usePortalTabData } from './context/PortalTabDataContext';
import { PortalLoading } from './components/portalTheme';
import type { PortalTabId } from './portalTabTypes';

export type { PortalTabId } from './portalTabTypes';

const TABS: { id: PortalTabId; label: string }[] = [
  { id: 'summary', label: 'Dashboard' },
  { id: 'stages', label: 'Case Status' },
  { id: 'finance', label: 'Finance' },
  { id: 'documents', label: 'Documents' },
  { id: 'contacts', label: 'My contacts' },
  { id: 'meetings', label: 'Meetings' },
];

const TAB_ORDER = TABS.map((tab) => tab.id);

const PortalCaseContent: React.FC<{
  contact: ReturnType<typeof usePortalSession>['contact'];
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  leadSummary: ReturnType<typeof usePortalSession>['leadSummary'];
}> = ({ contact, refreshSession, logout, leadSummary }) => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PortalTabId>('summary');
  const { data, initialLoading, refresh } = usePortalTabData();
  const contactProfileImageUrl = contact?.portal_profile_image_path
    ? data?.contactProfileSignedUrls?.[contact.portal_profile_image_path] ?? null
    : null;

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (
      tab === 'meetings'
      || tab === 'summary'
      || tab === 'stages'
      || tab === 'finance'
      || tab === 'documents'
      || tab === 'contacts'
    ) {
      setActiveTab(tab as PortalTabId);
    }
  }, [searchParams]);

  const goToMeetingsTab = useCallback(() => {
    setActiveTab('meetings');
  }, []);

  const renderTab = useCallback(
    (tab: PortalTabId) => {
      if (initialLoading && !data) {
        return <PortalLoading />;
      }

      switch (tab) {
        case 'summary':
          return (
            <PortalDashboardTab
              sessionContact={contact}
              onNavigate={setActiveTab}
              onRequestMeeting={goToMeetingsTab}
              onSessionRefresh={() => void refreshSession()}
            />
          );
        case 'stages':
          return <PortalStagesTab />;
        case 'finance':
          return data?.finances ? (
            <PortalFinanceTab
              payments={data.finances.payments ?? []}
              proformas={data.finances.proformas ?? []}
              isLegacy={data.finances.is_legacy}
            />
          ) : (
            <PortalLoading />
          );
        case 'documents':
          return <PortalDocumentsTab />;
        case 'contacts':
          return (
            <PortalContactsTab
              onSessionRefresh={() => void refreshSession()}
              sessionContactId={contact?.id}
            />
          );
        case 'meetings':
          return data?.meetings ? (
            <PortalMeetingsTab
              meetings={data.meetings.meetings ?? []}
              sessionContactId={contact?.id ?? null}
              onMeetingsChange={() => void refresh('meetings')}
            />
          ) : (
            <PortalLoading />
          );
        default:
          return null;
      }
    },
    [contact, data, goToMeetingsTab, initialLoading, refresh, refreshSession],
  );

  const tabTurn = useMemo(
    () => <PortalTabPageTurn activeTab={activeTab} tabOrder={TAB_ORDER} renderTab={renderTab} />,
    [activeTab, renderTab],
  );

  return (
    <PortalLayout
      leadSummary={leadSummary}
      contact={contact}
      contactProfileImageUrl={contactProfileImageUrl}
      onLogout={logout}
      onSettings={() => setActiveTab('contacts')}
      navTabs={TABS}
      activeNavTab={activeTab}
      onNavTabChange={(tabId) => setActiveTab(tabId as PortalTabId)}
    >
      {tabTurn}
    </PortalLayout>
  );
};

const PortalCasePage: React.FC = () => {
  const { loading, valid, leadSummary, contact, logout, refresh, leadRef } = usePortalSession(true);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-[#f7f7fb] to-[#f1f2f6]">
        <PortalLoading />
      </div>
    );
  }

  if (!valid) return null;

  return (
    <PortalTabDataProvider leadRef={leadRef} leadSummary={leadSummary}>
      <PortalCaseContent
        contact={contact}
        refreshSession={refresh}
        logout={logout}
        leadSummary={leadSummary}
      />
    </PortalTabDataProvider>
  );
};

export default PortalCasePage;
