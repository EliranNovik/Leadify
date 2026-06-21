import React, { useCallback, useEffect, useState } from 'react';
import PortalLayout from './PortalLayout';
import { usePortalSession } from './usePortalSession';
import PortalDashboardTab from './tabs/PortalDashboardTab';
import PortalStagesTab from './tabs/PortalStagesTab';
import PortalFinanceTab from './tabs/PortalFinanceTab';
import PortalDocumentsTab from './tabs/PortalDocumentsTab';
import PortalContactsTab from './tabs/PortalContactsTab';
import PortalMeetingsTab from './tabs/PortalMeetingsTab';
import PortalMeetingRequestDrawer from './PortalMeetingRequestDrawer';
import { portalGetFinances, portalGetMeetings } from '../../lib/portalApi';
import { PortalLoading } from './components/portalTheme';
import { usePortalContactProfileUrls } from './hooks/usePortalContactProfileUrls';

export type PortalTabId = 'summary' | 'stages' | 'finance' | 'documents' | 'contacts' | 'meetings';

const TABS: { id: PortalTabId; label: string }[] = [
  { id: 'summary', label: 'Dashboard' },
  { id: 'stages', label: 'Case Status' },
  { id: 'finance', label: 'Finance' },
  { id: 'documents', label: 'Documents' },
  { id: 'contacts', label: 'My contacts' },
  { id: 'meetings', label: 'Meetings' },
];

const PortalCasePage: React.FC = () => {
  const { loading, valid, leadSummary, contact, logout, refresh } = usePortalSession(true);
  const [activeTab, setActiveTab] = useState<PortalTabId>('summary');
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [financeData, setFinanceData] = useState<Awaited<ReturnType<typeof portalGetFinances>>>(null);
  const [meetingsData, setMeetingsData] = useState<Awaited<ReturnType<typeof portalGetMeetings>>>(null);
  const [dashboardKey, setDashboardKey] = useState(0);

  const profileUrls = usePortalContactProfileUrls([contact?.portal_profile_image_path]);
  const contactProfileImageUrl = contact?.portal_profile_image_path
    ? profileUrls[contact.portal_profile_image_path]
    : null;

  const loadMeetings = useCallback(async () => {
    try {
      setMeetingsData(await portalGetMeetings());
    } catch (err) {
      console.error('portal_get_meetings', err);
      setMeetingsData({ meetings: [], requests: [] });
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'finance') return;
    setFinanceData(null);
    void portalGetFinances()
      .then(setFinanceData)
      .catch((err) => {
        console.error('portal_get_finances', err);
        setFinanceData({ payments: [], proformas: [], is_legacy: false });
      });
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'meetings') return;
    setMeetingsData(null);
    void loadMeetings();
  }, [activeTab, loadMeetings]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#ececec]">
        <PortalLoading />
      </div>
    );
  }

  if (!valid) return null;

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
      {activeTab === 'summary' && (
        <PortalDashboardTab
          key={dashboardKey}
          sessionContact={contact}
          onNavigate={setActiveTab}
          onRequestMeeting={() => setMeetingOpen(true)}
          onSessionRefresh={() => void refresh()}
        />
      )}
      {activeTab === 'stages' && <PortalStagesTab />}
      {activeTab === 'finance' && financeData && (
        <PortalFinanceTab
          payments={financeData.payments ?? []}
          proformas={financeData.proformas ?? []}
          isLegacy={financeData.is_legacy}
        />
      )}
      {activeTab === 'finance' && !financeData && <PortalLoading />}
      {activeTab === 'documents' && <PortalDocumentsTab />}
      {activeTab === 'contacts' && (
        <PortalContactsTab onSessionRefresh={() => void refresh()} sessionContactId={contact?.id} />
      )}
      {activeTab === 'meetings' && meetingsData && (
        <PortalMeetingsTab
          meetings={meetingsData.meetings ?? []}
          requests={meetingsData.requests ?? []}
          meetingManager={{
            name: leadSummary?.meeting_manager_name,
            photoUrl: leadSummary?.meeting_manager_photo_url,
          }}
          onRequestMeeting={() => setMeetingOpen(true)}
        />
      )}
      {activeTab === 'meetings' && !meetingsData && <PortalLoading />}

      <PortalMeetingRequestDrawer
        open={meetingOpen}
        onClose={() => setMeetingOpen(false)}
        onSubmitted={() => {
          if (activeTab === 'meetings') void loadMeetings();
          if (activeTab === 'summary') setDashboardKey((k) => k + 1);
        }}
      />
    </PortalLayout>
  );
};

export default PortalCasePage;
