import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { MsalProvider, useMsal } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig, loginRequest } from './msalConfig';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AIChatWindow from './components/AIChatWindow';
import EmailThreadModal from './components/EmailThreadModal';
import ContactSelectorModal from './components/ContactSelectorModal';
import { supabase, sessionManager } from './lib/supabase';
import { CelebrationProvider } from './contexts/CelebrationContext';
import MoneyRainCelebration from './components/MoneyRainCelebration';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import PWAUpdateNotification from './components/PWAUpdateNotification';
import { MagnifyingGlassIcon, Cog6ToothIcon, HomeIcon, CalendarIcon, ChartBarIcon, UserGroupIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import Dashboard from './components/Dashboard';
import Clients from './components/Clients';
import LeadSearchPage from './pages/LeadSearchPage';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import ExpertPage from './components/ExpertPage';
import CalendarPage from './components/CalendarPage';
import WaitingForPriceOfferPage from './components/WaitingForPriceOfferPage';
import CreateNewLead from './components/CreateNewLead';
import LoginPage from './components/LoginPage';
import ProtectedRoute from './components/ProtectedRoute';
import OutlookCalendarPage from './components/OutlookCalendarPage';
import PipelinePage from './components/PipelinePage';
import NewCasesPage from './pages/NewCasesPage';
import NewHandlerCasesPage from './pages/NewHandlerCasesPage';
import MyCasesPage from './pages/MyCasesPage';
import CaseManagerPageNew from './components/CaseManagerPageNew';
import DoubleLeadsPage from './pages/DoubleLeadsPage';
import AdminPage from './components/admin/AdminPage';
import TeamsPage from './pages/TeamsPage';
import WhatsAppPage from './pages/WhatsAppPage';
import WhatsAppLeadsPage from './pages/WhatsAppLeadsPage';
import EmailThreadLeadPage from './pages/EmailThreadLeadPage';
import WhatsAppModal from './components/WhatsAppModal';
import CollectionPage from './pages/CollectionPage';
import MyPerformancePage from './pages/MyPerformancePage';
import ProformaViewPage from './pages/ProformaViewPage';
import ProformaLegacyViewPage from './pages/ProformaLegacyViewPage';
import ProformaLegacyCreatePage from './pages/ProformaLegacyCreatePage';
import ReportsPage from './pages/ReportsPage';
import CollectionFinancesReport from './pages/CollectionFinancesReport';
import MasterLeadPage from './components/MasterLeadPage';
import SettingsPage from './pages/SettingsPage';
import TimelinePage from './components/TimelinePage';
import HistoryPage from './components/HistoryPage';
import ContractPage from './components/ContractPage';
import PublicContractView from './pages/PublicContractView';
import PublicLegacyContractView from './pages/PublicLegacyContractView';
import PaymentPage from './pages/PaymentPage';
import CTIPopupPage from './pages/CTIPopupPage';
import CTIPopupModal from './components/CTIPopupModal';
import ProformaCreatePage from './pages/ProformaCreatePage';
import AboutPage from './pages/AboutPage';
import DocumentsPage from './pages/DocumentsPage';
import ContactPage from './pages/ContactPage';
import HowItWorksPage from './pages/HowItWorksPage';
import MeetingSummaryTestPage from './pages/MeetingSummaryTestPage';
import SimpleTestPage from './pages/SimpleTestPage';
import DebugTestPage from './pages/DebugTestPage';
import EmployeePerformancePage from './pages/EmployeePerformancePage';
import RMQMessagesPage from './pages/RMQMessagesPage';
import CallsLedgerPage from './pages/CallsLedgerPage';
import SchedulerToolPage from './pages/SchedulerToolPage';
import SignedSalesReportPage from './pages/SignedSalesReportPage';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
const AppContentInner: React.FC = () => {
  const { accounts, instance } = useMsal();
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin';
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
  
  // Contact selection state for email/WhatsApp
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [contactSelectorMode, setContactSelectorMode] = useState<'email' | 'whatsapp'>('email');
  const [selectedContactForThread, setSelectedContactForThread] = useState<{
    contact: any;
    leadId: string | number;
    leadType: 'legacy' | 'new';
  } | null>(null);
  const [appJustLoggedIn, setAppJustLoggedIn] = useState(false);
  const prevUser = useRef<any>(null);
  const navigate = useNavigate();

  // Listen for notification clicks from service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
          const url = event.data.url || '/';
          console.log('📱 Notification clicked, navigating to:', url);
          
          // Navigate to the URL
          navigate(url);
          
          // If the app was in background, focus the window
          if (window.document.hidden) {
            window.focus();
          }
        }
      };

      navigator.serviceWorker.addEventListener('message', handleMessage);
      
      return () => {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      };
    }
  }, [navigate]);

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
          unactivation_reason: legacyLead.unactivation_reason || null,
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
        console.log('🔄 Refreshing new lead data for ID:', clientId);
        const { data, error } = await supabase
          .from('leads')
          .select(`
            *,
            emails (*),
            balance,
            currency_id,
            proposal_total,
            subcontractor_fee,
            potential_total,
            vat,
            vat_value,
            number_of_applicants_meeting,
            accounting_currencies!leads_currency_id_fkey (
              id,
              name,
              iso_code
            )
          `)
          .eq('id', clientId)
          .single();
        if (error) throw error;
        // Extract currency data from joined table
        const currencyData = data.accounting_currencies 
          ? (Array.isArray(data.accounting_currencies) ? data.accounting_currencies[0] : data.accounting_currencies)
          : null;
        
        console.log('✅ New lead data refreshed:', { 
          id: data.id, 
          currency_id: data.currency_id,
          currency_iso_code: currencyData?.iso_code,
          balance: data.balance,
          proposal_total: data.proposal_total,
          subcontractor_fee: data.subcontractor_fee,
          potential_total: data.potential_total,
          vat: data.vat,
          vat_value: data.vat_value,
          number_of_applicants_meeting: data.number_of_applicants_meeting
        });
        // Convert currency_id to symbol for display (like legacy leads)
        const currencySymbol = (() => {
          if (currencyData?.iso_code) {
            const isoCode = currencyData.iso_code.toUpperCase();
            if (isoCode === 'ILS' || isoCode === 'NIS') return '₪';
            if (isoCode === 'USD') return '$';
            if (isoCode === 'EUR') return '€';
            if (isoCode === 'GBP') return '£';
            if (isoCode === 'CAD') return 'C$';
            if (isoCode === 'AUD') return 'A$';
            if (isoCode === 'JPY') return '¥';
            return currencyData.name || isoCode || '₪';
          }
          return '₪'; // Default fallback
        })();
        
        // Create a completely new object reference to ensure React detects the change
        // Spread all properties to create a new object reference
        // CRITICAL: Preserve ALL financial columns exactly as they come from the database
        const newClientData = {
          ...data,
          // Explicitly preserve financial columns - don't let them be overridden
          balance: data.balance,
          currency_id: data.currency_id, // Store currency_id
          proposal_total: data.proposal_total,
          subcontractor_fee: data.subcontractor_fee,
          potential_total: data.potential_total,
          vat: data.vat,
          vat_value: data.vat_value,
          number_of_applicants_meeting: data.number_of_applicants_meeting,
          // Compute currency symbols for backward compatibility
          balance_currency: currencySymbol,
          proposal_currency: currencySymbol,
          // Explicitly spread nested objects/arrays to ensure new references
          emails: data.emails ? [...(Array.isArray(data.emails) ? data.emails : [])] : []
        };
        console.log('🔄 Setting selectedClient with fresh data:', {
          currency_id: newClientData.currency_id,
          currency_iso_code: currencyData?.iso_code,
          currency_symbol: currencySymbol,
          balance: newClientData.balance
        });
        setSelectedClient(newClientData);
        console.log('✅ setSelectedClient called with new data, currency_id:', newClientData.currency_id, 'currency_symbol:', currencySymbol);
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
      <Route path="/cti/pop" element={<CTIPopupPage />} />
      <Route path="/documents" element={
        <div className="flex h-screen bg-white">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="bg-white border-b border-gray-200 px-4 md:px-6 py-4">
              {/* Desktop Layout */}
              <div className="hidden md:flex items-center justify-between">
                <div className="flex items-center gap-3">
                     <div className="p-2 rounded-lg" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #1e3a8a 100%)' }}>
                       <DocumentArrowUpIcon className="w-6 h-6 text-white" />
                     </div>
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
                    <p className="text-sm text-gray-500">Upload and manage documents in OneDrive</p>
                  </div>
                </div>
                <div className="flex-1 flex justify-center">
                  <h2 className="text-2xl font-bold" style={{ color: '#1e3a8a' }}>Decker, Pex, Levi Law Offices</h2>
                </div>
                <div className="flex items-center gap-4">
                  {!msalAccount ? (
                    <button
                      onClick={() => {
                        const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                        if (isMobile) {
                          instance.loginRedirect(loginRequest);
                        } else {
                          instance.loginPopup(loginRequest);
                        }
                      }}
                      className="btn btn-primary"
                      style={{ backgroundColor: '#1e40af', borderColor: '#1e40af' }}
                    >
                      <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
                      </svg>
                      Microsoft Login
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">Welcome, {msalAccount.name}</span>
                      <button
                        onClick={() => instance.logoutPopup()}
                        className="btn btn-outline btn-sm flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
                        </svg>
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden">
                {/* Top row - Logo and Auth */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #1e3a8a 100%)' }}>
                      <DocumentArrowUpIcon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold text-gray-900">Documents</h1>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!msalAccount ? (
                      <button
                        onClick={() => {
                          const isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                          if (isMobile) {
                            instance.loginRedirect(loginRequest);
                          } else {
                            instance.loginPopup(loginRequest);
                          }
                        }}
                        className="btn btn-primary btn-sm"
                        style={{ backgroundColor: '#1e40af', borderColor: '#1e40af' }}
                      >
                        <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
                        </svg>
                        <span className="text-sm">Login</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">Welcome, {msalAccount.name}</span>
                        <button
                          onClick={() => instance.logoutPopup()}
                          className="btn btn-outline btn-sm flex items-center gap-1"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
                          </svg>
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Bottom row - Law firm name */}
                <div className="text-center">
                  <h2 className="text-lg font-bold" style={{ color: '#1e3a8a' }}>Decker, Pex, Levi Law Offices</h2>
                  <p className="text-xs text-gray-500 mt-1">Upload and manage documents in OneDrive</p>
                </div>
              </div>
            </div>
            <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950" style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #1e3a8a 100%)' }}>
              <DocumentsPage />
            </main>
          </div>
        </div>
      } />
      <Route path="/calls-ledger" element={
        <ProtectedRoute user={authUser}>
          <div className="flex h-screen bg-white">
            <div className="flex-1 flex flex-col overflow-hidden">
              <Header 
                onMenuClick={() => setIsSidebarOpen(prev => !prev)} 
                onSearchClick={() => setIsSearchOpen(prev => !prev)}
                isSearchOpen={isSearchOpen}
                setIsSearchOpen={setIsSearchOpen}
                appJustLoggedIn={appJustLoggedIn}
                onOpenAIChat={() => setIsAiChatOpen(true)}
                onOpenEmailThread={() => {
                  if (selectedClient) {
                    const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                    const leadId = selectedClient.id || selectedClient.lead_number;
                    setShowContactSelector(true);
                    setContactSelectorMode('email');
                    setSelectedClient({ ...selectedClient, _tempLeadId: leadId, _tempLeadType: isLegacy ? 'legacy' : 'new' });
                  } else {
                    setIsEmailThreadOpen(true);
                  }
                }}
                onOpenWhatsApp={() => {
                  if (selectedClient) {
                    const isLegacy = selectedClient.lead_type === 'legacy' || selectedClient.id?.toString().startsWith('legacy_');
                    const leadId = selectedClient.id || selectedClient.lead_number;
                    setShowContactSelector(true);
                    setContactSelectorMode('whatsapp');
                    setSelectedClient({ ...selectedClient, _tempLeadId: leadId, _tempLeadType: isLegacy ? 'legacy' : 'new' });
                  } else {
                    window.location.href = '/whatsapp';
                  }
                }}
                onOpenMessaging={() => setIsMessagingOpen(true)}
                isMenuOpen={isSidebarOpen}
              />
              <main className="flex-1 overflow-x-hidden overflow-y-auto bg-white">
                <CallsLedgerPage />
              </main>
            </div>
          </div>
        </ProtectedRoute>
      } />
      <Route
        path="/*"
        element={
          <ProtectedRoute user={authUser}>
            <div className={`flex h-screen bg-base-100 ${appJustLoggedIn ? 'fade-in' : ''}`}>
              {!isAdminPage && (
                <Sidebar 
                  userName={userFullName || userName}
                  userInitials={userInitials}
                  isOpen={isSidebarOpen}
                  onClose={() => setIsSidebarOpen(false)}
                  onOpenAIChat={() => setIsAiChatOpen(true)}
                />
              )}
              <div className={`flex-1 flex flex-col overflow-hidden ${!isAdminPage ? 'md:pl-24' : ''}`}>
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
                    <Route path="/contract/:contractId" element={<ContractPage />} />
                    <Route path="/clients/:lead_number/timeline" element={<TimelinePage />} />
                    <Route path="/clients/:lead_number/history" element={<HistoryPage />} />
                    <Route path="/clients/:lead_number/master" element={<MasterLeadPage />} />
                    <Route path="/clients/:lead_number/*" element={<Clients selectedClient={selectedClient} setSelectedClient={setSelectedClient} refreshClientData={refreshClientData} />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/outlook-calendar" element={<OutlookCalendarPage />} />
                    <Route path="/waiting-for-price-offer" element={<WaitingForPriceOfferPage />} />
                    <Route path="/expert" element={<ExpertPage />} />
                    <Route path="/create" element={<CreateNewLead />} />
                    <Route path="/lead-search" element={<LeadSearchPage />} />
                    <Route path="/pipeline" element={<PipelinePage />} />
                    <Route path="/new-cases" element={<NewCasesPage />} />
                    <Route path="/new-handler-cases" element={<NewHandlerCasesPage />} />
                    <Route path="/my-cases" element={<MyCasesPage />} />
                    <Route path="/case-manager" element={<CaseManagerPageNew />} />
                    <Route path="/double-leads" element={<DoubleLeadsPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/teams" element={<TeamsPage />} />
                    <Route path="/employee-performance" element={<EmployeePerformancePage />} />
                    <Route path="/scheduler-tool" element={<SchedulerToolPage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/whatsapp-leads" element={<WhatsAppLeadsPage />} />
                    <Route path="/email-leads" element={<EmailThreadLeadPage />} />
                    <Route path="/collection" element={<CollectionPage />} />
                    <Route path="/performance" element={<MyPerformancePage />} />
                    <Route path="/proforma/:id" element={<ProformaViewPage />} />
                    <Route path="/proforma/create/:paymentId" element={<ProformaCreatePage />} />
                    <Route path="/proforma-legacy/:id" element={<ProformaLegacyViewPage />} />
                    <Route path="/proforma-legacy/create/:leadId" element={<ProformaLegacyCreatePage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/reports/collection-finances" element={<CollectionFinancesReport />} />
                    <Route path="/sales/signed" element={<SignedSalesReportPage />} />
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
              {/* Contact Selector Modal */}
              {selectedClient && (selectedClient as any)._tempLeadId && (
                <ContactSelectorModal
                  isOpen={showContactSelector}
                  onClose={() => {
                    setShowContactSelector(false);
                    setSelectedContactForThread(null);
                  }}
                  leadId={(selectedClient as any)._tempLeadId}
                  leadType={(selectedClient as any)._tempLeadType || 'new'}
                  leadName={selectedClient.name}
                  leadNumber={selectedClient.lead_number}
                  leadEmail={selectedClient.email}
                  leadPhone={selectedClient.phone}
                  leadMobile={selectedClient.mobile}
                  mode={contactSelectorMode}
                  onContactSelected={(contact, leadId, leadType) => {
                    setSelectedContactForThread({ contact, leadId, leadType });
                    if (contactSelectorMode === 'email') {
                      setIsEmailThreadOpen(true);
                    } else {
                      setIsWhatsAppOpen(true);
                    }
                  }}
                />
              )}
              <EmailThreadModal 
                isOpen={isEmailThreadOpen} 
                onClose={() => {
                  setIsEmailThreadOpen(false);
                  setSelectedContactForThread(null);
                }}
                selectedContact={selectedContactForThread}
              />
              <WhatsAppModal 
                isOpen={isWhatsAppOpen} 
                onClose={() => {
                  setIsWhatsAppOpen(false);
                  setSelectedContactForThread(null);
                }}
                selectedContact={selectedContactForThread}
              />
              <RMQMessagesPage 
                isOpen={isMessagingOpen} 
                onClose={() => setIsMessagingOpen(false)} 
              />
              {/* CTI Popup Modal - shows on any authenticated page when phone parameter is present */}
              <CTIPopupModal />
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
      <CelebrationProvider>
        <Router>
          <AppContentInner />
          <MoneyRainCelebration />
          <PWAInstallPrompt />
          <PWAUpdateNotification />
          <Toaster 
            position="top-center"
            reverseOrder={false}
          />
        </Router>
      </CelebrationProvider>
    </AuthProvider>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
