import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { PortalI18nProvider } from './i18n/PortalI18nProvider';
import type { PortalTabId } from './portalTabTypes';

export type { PortalTabId } from './portalTabTypes';

const TAB_IDS: PortalTabId[] = [
  'summary',
  'stages',
  'finance',
  'documents',
  'contacts',
  'meetings',
];

const NAV_LABEL_KEYS: Record<PortalTabId, string> = {
  summary: 'nav.dashboard',
  stages: 'nav.caseStatus',
  finance: 'nav.finance',
  documents: 'nav.documents',
  contacts: 'nav.myContacts',
  meetings: 'nav.meetings',
};

const PortalCaseContent: React.FC<{
  contact: ReturnType<typeof usePortalSession>['contact'];
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  leadSummary: ReturnType<typeof usePortalSession>['leadSummary'];
}> = ({ contact, refreshSession, logout, leadSummary }) => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PortalTabId>('summary');
  const { data, initialLoading, refresh } = usePortalTabData();
  const contactProfileImageUrl = contact?.portal_profile_image_path
    ? data?.contactProfileSignedUrls?.[contact.portal_profile_image_path] ?? null
    : null;

  const navTabs = useMemo(
    () => TAB_IDS.map((id) => ({ id, label: t(NAV_LABEL_KEYS[id]) })),
    [t],
  );

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
          return <PortalDocumentsTab sessionContactId={contact?.id ?? null} />;
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
    () => <PortalTabPageTurn activeTab={activeTab} tabOrder={TAB_IDS} renderTab={renderTab} />,
    [activeTab, renderTab],
  );

  return (
    <PortalLayout
      leadSummary={leadSummary}
      contact={contact}
      contactProfileImageUrl={contactProfileImageUrl}
      onLogout={logout}
      onSettings={() => setActiveTab('contacts')}
      navTabs={navTabs}
      activeNavTab={activeTab}
      onNavTabChange={(tabId) => setActiveTab(tabId as PortalTabId)}
    >
      {tabTurn}
    </PortalLayout>
  );
};

const PortalCasePageInner: React.FC = () => {
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

const PortalCasePage: React.FC = () => (
  <PortalI18nProvider>
    <PortalCasePageInner />
  </PortalI18nProvider>
);

export default PortalCasePage;
