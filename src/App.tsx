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
import { supabase } from './lib/supabase';
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
import AdminPage from './components/admin/AdminPage';
import TeamsPage from './pages/TeamsPage';
import WhatsAppPage from './pages/WhatsAppPage';
import CollectionPage from './pages/CollectionPage';
import MyPerformancePage from './pages/MyPerformancePage';
import ProformaViewPage from './pages/ProformaViewPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import TimelinePage from './components/TimelinePage';
import HistoryPage from './components/HistoryPage';
import ContractPage from './components/ContractPage';
import PublicContractView from './pages/PublicContractView';
import PaymentPage from './pages/PaymentPage';
import ProformaCreatePage from './pages/ProformaCreatePage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import HowItWorksPage from './pages/HowItWorksPage';


const AppContent: React.FC = () => {
  const { accounts, instance } = useMsal();
  const msalAccount = instance.getActiveAccount() || accounts[0];
  const userName = accounts.length > 0 ? accounts[0].name : undefined;

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [appJustLoggedIn, setAppJustLoggedIn] = useState(false);
  const prevUser = useRef<any>(null);
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [userInitials, setUserInitials] = useState<string | null>(null);

  const refreshClientData = useCallback(async (clientId: number) => {
    if (!clientId) return;
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*, emails (*)')
        .eq('id', clientId)
        .single();
      if (error) throw error;
      setSelectedClient(data);
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

  useEffect(() => {
    const session = supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setIsLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user && user.email) {
      supabase
        .from('users')
        .select('full_name')
        .eq('email', user.email)
        .single()
        .then(({ data, error }) => {
          if (!error && data?.full_name) {
            setUserFullName(data.full_name);
            setUserInitials(data.full_name.split(' ').map((n: string) => n[0]).join(''));
          }
        });
    }
  }, [user]);

  // Detect login transition for animation
  useEffect(() => {
    if (!prevUser.current && user) {
      setAppJustLoggedIn(true);
      setTimeout(() => setAppJustLoggedIn(false), 900);
    }
    prevUser.current = user;
  }, [user]);

  const authUser = user || msalAccount;

  if (isLoading) {
    return <div className="flex justify-center items-center min-h-screen"><span className="loading loading-spinner loading-lg text-primary"></span></div>;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/how-it-works" element={<HowItWorksPage />} />
      <Route path="/public-contract/:contractId/:token" element={<PublicContractView />} />
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
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/teams" element={<TeamsPage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/collection" element={<CollectionPage />} />
                    <Route path="/performance" element={<MyPerformancePage />} />
                    <Route path="/proforma/:id" element={<ProformaViewPage />} />
                    <Route path="/proforma/create/:paymentId" element={<ProformaCreatePage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </main>
              </div>
              <AIChatWindow 
                isOpen={isAiChatOpen} 
                onClose={() => setIsAiChatOpen(false)} 
                onClientUpdate={selectedClient ? () => refreshClientData(selectedClient.id) : undefined}
                userName={userFullName || userName}
              />
            </div>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <>
      <Router>
        <AppContent />
      </Router>
      <Toaster 
        position="top-center"
        reverseOrder={false}
      />
    </>
  );
};

export default App;
