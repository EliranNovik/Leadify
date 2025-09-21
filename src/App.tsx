import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { MsalProvider, useMsal } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from './msalConfig';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AIChatWindow from './components/AIChatWindow';
import EmailThreadModal from './components/EmailThreadModal';
import { supabase, sessionManager } from './lib/supabase';
import { MagnifyingGlassIcon, Cog6ToothIcon, HomeIcon, CalendarIcon, ChartBarIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import Dashboard from './components/Dashboard';
import Clients from './components/Clients';
import LeadSearchPage from './pages/LeadSearchPage';
import { Routes, Route } from 'react-router-dom';
import ExpertPage from './components/ExpertPage';
import CalendarPage from './components/CalendarPage';
import CreateNewLead from './components/CreateNewLead';
import LoginPage from './components/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import OutlookCalendarPage from './components/OutlookCalendarPage';
import PipelinePage from './components/PipelinePage';
import NewCasesPage from './pages/NewCasesPage';
import NewHandlerCasesPage from './pages/NewHandlerCasesPage';
import CaseManagerPageNew from './components/CaseManagerPageNew';
import DoubleLeadsPage from './pages/DoubleLeadsPage';
import AdminPage from './components/admin/AdminPage';
import TeamsPage from './pages/TeamsPage';
import WhatsAppPage from './pages/WhatsAppPage';
import WhatsAppModal from './components/WhatsAppModal';
import CollectionPage from './pages/CollectionPage';
import MyPerformancePage from './pages/MyPerformancePage';
import ProformaViewPage from './pages/ProformaViewPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import TimelinePage from './components/TimelinePage';
import HistoryPage from './components/HistoryPage';
import ContractPage from './components/ContractPage';
import PublicContractView from './pages/PublicContractView';
import PublicLegacyContractView from './pages/PublicLegacyContractView';
import PaymentPage from './pages/PaymentPage';
import ProformaCreatePage from './pages/ProformaCreatePage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import HowItWorksPage from './pages/HowItWorksPage';
import MeetingSummaryTestPage from './pages/MeetingSummaryTestPage';
import SimpleTestPage from './pages/SimpleTestPage';
import DebugTestPage from './pages/DebugTestPage';
import EmployeePerformancePage from './pages/EmployeePerformancePage';
import RMQMessagesPage from './pages/RMQMessagesPage';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
const AppContentInner: React.FC = () => {
  const { accounts, instance } = useMsal();
  const msalAccount = instance.getActiveAccount() || accounts[0];
  const userName = accounts.length > 0 ? accounts[0].name : undefined;
  
  // Get auth state from context
  const { user, userFullName, userInitials, isLoading, isInitialized } = useAuthContext();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [isAiChatFullPage, setIsAiChatFullPage] = useState(false);
  const [isEmailThreadOpen, setIsEmailThreadOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [appJustLoggedIn, setAppJustLoggedIn] = useState(false);
  const prevUser = useRef<any>(null);

  const refreshClientData = useCallback(async (clientId: number | string) => {
    if (!clientId) return;
    try {
      // Check if it's a legacy lead
      if (clientId.toString().startsWith('legacy_')) {
        const legacyId = parseInt(clientId.toString().replace('legacy_', ''));
        console.log('🔄 Refreshing legacy client data for ID:', legacyId);
        
        // Fetch legacy lead data with currency information
        const { data: legacyLead, error: legacyError } = await supabase
          .from('leads_lead')
          .select(`
            *,
            accounting_currencies!leads_lead_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('id', legacyId)
          .single();
          
        if (legacyError) throw legacyError;
        
        // Fetch emails for legacy lead
        const { data: legacyEmails, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .eq('legacy_id', legacyId)
          .order('sent_at', { ascending: false });
          
        if (emailsError) {
          console.error('Error fetching legacy emails:', emailsError);
        }
        
        // Transform legacy lead to match new lead structure
        const clientData = {
          ...legacyLead,
          id: `legacy_${legacyLead.id}`,
          lead_number: String(legacyLead.id),
          stage: String(legacyLead.stage || ''),
          source: String(legacyLead.source_id || ''),
          created_at: legacyLead.cdate,
          updated_at: legacyLead.udate,
          notes: legacyLead.notes || '',
          special_notes: legacyLead.special_notes || '',
          next_followup: legacyLead.next_followup || '',
          probability: String(legacyLead.probability || ''),
          category: String(legacyLead.category_id || legacyLead.category || ''),
          language: String(legacyLead.language_id || ''),
          balance: String(legacyLead.total || ''),
          balance_currency: legacyLead.accounting_currencies?.name || (() => {
            // Fallback currency mapping based on currency_id
            switch (legacyLead.currency_id) {
              case 1: return '₪';
              case 2: return '€';
              case 3: return '$';
              case 4: return '£';
              default: return '₪';
            }
          })(),
          lead_type: 'legacy',
          client_country: null,
          emails: legacyEmails || [],
          closer: null,
          handler: null,
          unactivation_reason: null,
          deactivate_note: legacyLead.deactivate_note || null,
        };
        
        console.log('✅ Legacy client data refreshed:', { 
          emailsFound: legacyEmails?.length || 0,
          clientId: clientData.id 
        });
        
        // Check if this should be shown as unactivated view
        const isLegacy = clientData.lead_type === 'legacy' || clientData.id?.toString().startsWith('legacy_');
        const unactivationReason = isLegacy ? clientData.deactivate_note : clientData.unactivation_reason;
        const isUnactivated = isLegacy ? 
          (String(clientData.stage) === '91' || (unactivationReason && unactivationReason.trim() !== '')) :
          ((unactivationReason && unactivationReason.trim() !== '') || false);
        
        console.log('🔍 App.tsx - Legacy unactivation check:', {
          isLegacy,
          stage: clientData.stage,
          deactivate_note: clientData.deactivate_note,
          unactivation_reason: clientData.unactivation_reason,
          isUnactivated
        });
        
        setSelectedClient(clientData);
      } else {
        // Handle new leads
        const { data, error } = await supabase
          .from('leads')
          .select('*, emails (*)')
          .eq('id', clientId)
          .single();
        if (error) throw error;
        setSelectedClient(data);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
    }
  }, []);

  const navItems = [
    { href: '/', label: 'Home', icon: HomeIcon },
    { href: '/clients', label: 'Clients', icon: UserGroupIcon },
    { href: '/calendar', label: 'Calendar', icon: CalendarIcon },
    { href: '/statistics', label: 'Statistics', icon: ChartBarIcon },
    { href: '/lead-search', label: 'Lead Search', icon: MagnifyingGlassIcon },
  ];

  // Detect login transition for animation
  useEffect(() => {
    if (!prevUser.current && user) {
      setAppJustLoggedIn(true);
      setTimeout(() => setAppJustLoggedIn(false), 900);
    }
    prevUser.current = user;
  }, [user]);

  // Session monitoring is now handled in AuthContext to avoid conflicts

  // Only use Supabase user - no Microsoft fallback
  const authUser = user;

  // Don't block the app on auth loading - allow it to render immediately
  // The auth will load in the background

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/public-contract/:contractId/:token" element={<PublicContractView />} />
      <Route path="/public-legacy-contract/:contractId/:token" element={<PublicLegacyContractView />} />
      <Route path="/payment/:token" element={<PaymentPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute user={authUser}>
            <div className={`flex h-screen bg-base-100 ${appJustLoggedIn ? 'fade-in' : ''}`}>
              <Sidebar 
                userName={userFullName || userName}
                userInitials={userInitials}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onOpenAIChat={() => setIsAiChatOpen(true)}
              />
              <div className="flex-1 flex flex-col overflow-hidden md:pl-24">
                <Header 
                  onMenuClick={() => setIsSidebarOpen(prev => !prev)} 
                  onSearchClick={() => setIsSearchOpen(prev => !prev)}
                  isSearchOpen={isSearchOpen}
                  setIsSearchOpen={setIsSearchOpen}
                  appJustLoggedIn={appJustLoggedIn}
                  onOpenAIChat={() => setIsAiChatOpen(true)}
                  onOpenEmailThread={() => setIsEmailThreadOpen(true)}
                  onOpenWhatsApp={() => setIsWhatsAppOpen(true)}
                  onOpenMessaging={() => setIsMessagingOpen(true)}
                  isMenuOpen={isSidebarOpen}
                />
                <main className="flex-1 overflow-x-hidden overflow-y-auto">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/clients" element={<Clients selectedClient={selectedClient} setSelectedClient={setSelectedClient} refreshClientData={refreshClientData} />} />
                    <Route path="/clients/:lead_number/contract" element={<ContractPage />} />
                    <Route path="/clients/:lead_number/timeline" element={<TimelinePage />} />
                    <Route path="/clients/:lead_number/history" element={<HistoryPage />} />
                    <Route path="/clients/:lead_number/*" element={<Clients selectedClient={selectedClient} setSelectedClient={setSelectedClient} refreshClientData={refreshClientData} />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/outlook-calendar" element={<OutlookCalendarPage />} />
                    <Route path="/expert" element={<ExpertPage />} />
                    <Route path="/create" element={<CreateNewLead />} />
                    <Route path="/lead-search" element={<LeadSearchPage />} />
                    <Route path="/pipeline" element={<PipelinePage />} />
                    <Route path="/new-cases" element={<NewCasesPage />} />
                    <Route path="/new-handler-cases" element={<NewHandlerCasesPage />} />
                    <Route path="/case-manager" element={<CaseManagerPageNew />} />
                    <Route path="/double-leads" element={<DoubleLeadsPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/teams" element={<TeamsPage />} />
                    <Route path="/employee-performance" element={<EmployeePerformancePage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/collection" element={<CollectionPage />} />
                    <Route path="/performance" element={<MyPerformancePage />} />
                    <Route path="/proforma/:id" element={<ProformaViewPage />} />
                    <Route path="/proforma/create/:paymentId" element={<ProformaCreatePage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/test-meeting-summary" element={<MeetingSummaryTestPage />} />
                    <Route path="/simple-test" element={<SimpleTestPage />} />
                    <Route path="/debug-test" element={<DebugTestPage />} />
                  </Routes>
                </main>
              </div>
              <AIChatWindow 
                isOpen={isAiChatOpen} 
                onClose={() => setIsAiChatOpen(false)} 
                onClientUpdate={selectedClient ? () => refreshClientData(selectedClient.id) : undefined}
                userName={userFullName || userName}
                isFullPage={isAiChatFullPage}
                onToggleFullPage={() => setIsAiChatFullPage(!isAiChatFullPage)}
              />
              <EmailThreadModal 
                isOpen={isEmailThreadOpen} 
                onClose={() => setIsEmailThreadOpen(false)} 
              />
              <WhatsAppModal 
                isOpen={isWhatsAppOpen} 
                onClose={() => setIsWhatsAppOpen(false)} 
              />
              <RMQMessagesPage 
                isOpen={isMessagingOpen} 
                onClose={() => setIsMessagingOpen(false)} 
              />
            </div>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

const AppContent: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <AppContentInner />
        <Toaster 
          position="top-center"
          reverseOrder={false}
        />
      </Router>
    </AuthProvider>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
