import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import ScrollRestoration from './components/ScrollRestoration';
import { MsalProvider, useMsal } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig, loginRequest } from './msalConfig';
import { Toaster } from 'react-hot-toast';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AIChatWindow from './components/AIChatWindow';
import EmailThreadModal from './components/EmailThreadModal';
import ContactSelectorModal from './components/ContactSelectorModal';
import { supabase } from './lib/supabase';
import { CelebrationProvider } from './contexts/CelebrationContext';
import { MailboxReconnectProvider } from './contexts/MailboxReconnectContext';
import MoneyRainCelebration from './components/MoneyRainCelebration';
import MailboxReconnectModal from './components/MailboxReconnectModal';
import PWAUpdateNotification from './components/PWAUpdateNotification';
import MobileBottomNav from './components/MobileBottomNav';
import { MagnifyingGlassIcon, Cog6ToothIcon, HomeIcon, CalendarIcon, ChartBarIcon, UserGroupIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import WhatsAppModal, { type WhatsAppModalSelectedContact } from './components/WhatsAppModal';
import CTIPopupModal from './components/CTIPopupModal';
import RMQMessagesPage from './pages/RMQMessagesPage';
import PageLoader from './components/PageLoader';
import {
  LazyAboutPage,
  LazyAdminPage,
  LazyBusinessCardPage,
  LazyCalendarPage,
  LazyCallsLedgerPage,
  LazyCaseDetailsPage,
  LazyCaseManagerPageNew,
  LazyClients,
  LazyCloserSuperPipelinePage,
  LazyCollectionDueReportPage,
  LazyCollectionFinancesReport,
  LazyCollectionPage,
  LazyContactPage,
  LazyContractPage,
  LazyCreateNewLead,
  LazyCTIPopupPage,
  LazyDebugTestPage,
  LazyDocumentsPage,
  LazyDoubleLeadsPage,
  LazyEditContractsPage,
  LazyEmailThreadLeadPage,
  LazyEmployeeInfoReport,
  LazyEmployeePerformancePage,
  LazyEmployeeSalariesReport,
  LazyEmployeeUnavailabilitiesReport,
  LazyExpertPage,
  LazyExternalUserAccessLogsPage,
  LazyExternalUserHomePage,
  LazyExternalUserSettingsPage,
  LazyHandlerManagementPage,
  LazyHistoryPage,
  LazyHowItWorksPage,
  LazyLeadSearchPage,
  LazyLeadsReportPage,
  LazyTagsManagerPage,
  LazyLoginPage,
  LazyMasterLeadPage,
  LazyMeetingSummaryTestPage,
  LazyMyCasesPage,
  LazyMyPerformancePage,
  LazyMyProfilePage,
  LazyNewCasesPage,
  LazyNewHandlerCasesPage,
  LazyOutlookCalendarPage,
  LazyPaymentPage,
  LazyPipelinePage,
  LazyProformaCreatePage,
  LazyProformaLegacyCreatePage,
  LazyProformaLegacyViewPage,
  LazyProformaViewPage,
  LazyPublicContractView,
  LazyPublicLegacyContractView,
  LazyPublicProfilePage,
  LazyReassignLeadsPage,
  LazyReportsPage,
  LazyRetainerHandlerCasesPage,
  LazySalesContributionPage,
  LazySchedulerToolPage,
  LazySettingsPage,
  LazySignedSalesReportPage,
  LazySimpleTestPage,
  LazyTeamsPage,
  LazyTimelinePage,
  LazyWaitingForPriceOfferPage,
  LazyWhatsAppLeadsPage,
  LazyWhatsAppPage,
} from './routes/lazyPages';
import HomeEntryPage from './pages/HomeEntryPage';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { captureRefreshPathnameOnce } from './hooks/usePersistedState';

function RouteSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

const AppContentInner: React.FC = () => {
  const { accounts, instance } = useMsal();
  const location = useLocation();

  // Capture pathname at reload time so persisted state is only cleared for the route that was refreshed
  useEffect(() => {
    captureRefreshPathnameOnce();
  }, []);

  // Memoize page flags to prevent unnecessary re-renders of Header/Sidebar
  const isAdminPage = useMemo(() => location.pathname === '/admin', [location.pathname]);
  const isReportsPage = useMemo(() => location.pathname.startsWith('/reports'), [location.pathname]);
  const isSignedSalesPage = useMemo(() => location.pathname === '/sales/signed', [location.pathname]);
  const isCaseManagerPage = useMemo(() => location.pathname.startsWith('/case-manager'), [location.pathname]);
  const isContractPage = useMemo(() => location.pathname.includes('/contract') && !location.pathname.includes('/public-contract'), [location.pathname]);
  const msalAccount = instance.getActiveAccount() || accounts[0];
  const userName = accounts.length > 0 ? accounts[0].name : undefined;

  // Get auth state from context
  const { user, userFullName, userInitials, isLoading, isInitialized } = useAuthContext();

  // Memoize computed props for Header/Sidebar to prevent unnecessary re-renders
  const sidebarUserName = useMemo(() => userFullName || userName, [userFullName, userName]);
  const sidebarMobileOnly = useMemo(() => isReportsPage || isAdminPage, [isReportsPage, isAdminPage]);
  const showBottomNav = useMemo(
    () => !isContractPage && !isCaseManagerPage && !isReportsPage,
    [isContractPage, isCaseManagerPage, isReportsPage]
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [isAiChatFullPage, setIsAiChatFullPage] = useState(false);
  const [isEmailThreadOpen, setIsEmailThreadOpen] = useState(false);
  const [isWhatsAppOpen, setIsWhatsAppOpen] = useState(false);
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  /** Open RMQ to a specific thread/message (e.g. from CRM “Flagged” modal). */
  const [rmqInitialConversationId, setRmqInitialConversationId] = useState<number | undefined>();
  const [rmqInitialScrollToMessageId, setRmqInitialScrollToMessageId] = useState<number | undefined>();
  const [selectedClient, setSelectedClient] = useState<any>(null);

  // Clear selectedClient when navigating away from Clients page to prevent flash of stale client data
  const isClientsRoute = location.pathname === '/clients' || location.pathname.startsWith('/clients/');
  useEffect(() => {
    if (!isClientsRoute && selectedClient) {
      setSelectedClient(null);
    }
  }, [isClientsRoute, selectedClient]);

  // Contact selection state for email/WhatsApp
  const [showContactSelector, setShowContactSelector] = useState(false);
  const [contactSelectorMode, setContactSelectorMode] = useState<'email' | 'whatsapp'>('email');
  const [selectedContactForThread, setSelectedContactForThread] = useState<WhatsAppModalSelectedContact | null>(null);
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

        // Calculate sub-lead suffix if this is a sub-lead (has master_id)
        let subLeadSuffix: number | undefined;
        if (legacyLead.master_id) {
          const { data: existingSubLeads } = await supabase
            .from('leads_lead')
            .select('id')
            .eq('master_id', legacyLead.master_id)
            .not('master_id', 'is', null)
            .order('id', { ascending: true });

          if (existingSubLeads) {
            const currentLeadIndex = existingSubLeads.findIndex(sub => sub.id === legacyLead.id);
            // Suffix starts at 2 (first sub-lead is /2, second is /3, etc.)
            subLeadSuffix = currentLeadIndex >= 0 ? currentLeadIndex + 2 : existingSubLeads.length + 2;
          }
        }

        // Format lead number for legacy leads (same logic as Clients.tsx)
        const formatLegacyLeadNumber = (legacyLeadData: any, suffix?: number): string => {
          const masterId = legacyLeadData.master_id;
          const leadId = String(legacyLeadData.id);

          // If master_id is null/empty, it's a master lead - return just the ID
          if (!masterId || String(masterId).trim() === '') {
            return leadId;
          }

          // If master_id exists, it's a sub-lead
          // Use provided suffix if available
          if (suffix !== undefined) {
            return `${masterId}/${suffix}`;
          }

          // If suffix not provided, return a placeholder
          return `${masterId}/?`;
        };

        // Fetch emails for legacy lead
        const { data: legacyEmails, error: emailsError } = await supabase
          .from('emails')
          .select('*')
          .eq('legacy_id', legacyId)
          .order('sent_at', { ascending: false });

        if (emailsError) {
          console.error('Error fetching legacy emails:', emailsError);
        }

        // Fetch language name if language_id exists
        let languageName = '';
        if (legacyLead.language_id) {
          try {
            const { data: languageData, error: languageError } = await supabase
              .from('misc_language')
              .select('name')
              .eq('id', legacyLead.language_id)
              .maybeSingle();

            if (!languageError && languageData?.name) {
              languageName = languageData.name;
              console.log('✅ App.tsx - Fetched language name:', { language_id: legacyLead.language_id, languageName });
            } else {
              console.warn('⚠️ App.tsx - Could not fetch language name for language_id:', legacyLead.language_id, languageError);
            }
          } catch (langError) {
            console.error('Error fetching language name:', langError);
          }
        } else {
          console.log('⚠️ App.tsx - No language_id in legacy lead, language_id:', legacyLead.language_id);
        }

        // Fetch category name if category_id exists
        let categoryName = '';
        if (legacyLead.category_id) {
          try {
            const { data: categoryData, error: categoryError } = await supabase
              .from('misc_category')
              .select('name')
              .eq('id', legacyLead.category_id)
              .maybeSingle();

            if (!categoryError && categoryData?.name) {
              categoryName = categoryData.name;
              console.log('✅ App.tsx - Fetched category name:', { category_id: legacyLead.category_id, categoryName });
            } else {
              console.warn('⚠️ App.tsx - Could not fetch category name for category_id:', legacyLead.category_id, categoryError);
            }
          } catch (catError) {
            console.error('Error fetching category name:', catError);
          }
        }

        // Preserve existing selectedClient properties that might be computed/derived
        const existingClient = selectedClient;
        // Use fetched language name if available, otherwise preserve existing if it's valid (not empty string), otherwise empty
        const finalLanguage = languageName || (existingClient?.language && existingClient.language.trim() !== '' && existingClient.language !== String(legacyLead.language_id || '') ? existingClient.language : '');
        // Use fetched category name if available, otherwise preserve existing if it's valid
        const finalCategory = categoryName || (existingClient?.category && existingClient.category.trim() !== '' && existingClient.category !== String(legacyLead.category_id || '') ? existingClient.category : '');

        const preservedProperties = {
          // Use fetched language name, or preserve existing if it exists and is valid, otherwise use empty string
          language: finalLanguage,
          // Preserve category name if it exists (it's computed from category_id)
          category: finalCategory,
          // Preserve other computed properties - use database values as source of truth (database is authoritative)
          total_base: legacyLead.total_base !== null && legacyLead.total_base !== undefined ? legacyLead.total_base : existingClient?.total_base,
          total: legacyLead.total !== null && legacyLead.total !== undefined ? legacyLead.total : existingClient?.total,
          subcontractor_fee: legacyLead.subcontractor_fee !== null && legacyLead.subcontractor_fee !== undefined ? legacyLead.subcontractor_fee : existingClient?.subcontractor_fee,
          master_id: legacyLead.master_id !== null && legacyLead.master_id !== undefined ? legacyLead.master_id : existingClient?.master_id,
        };

        console.log('🔍 App.tsx - Preserving properties during refresh:', {
          legacyLeadLanguageId: legacyLead.language_id,
          fetchedLanguageName: languageName,
          existingLanguage: existingClient?.language,
          finalLanguage: preservedProperties.language,
          existingCategory: existingClient?.category,
          existingTotalBase: existingClient?.total_base,
          legacyTotalBase: legacyLead.total_base,
          existingTotal: existingClient?.total,
          legacyTotal: legacyLead.total,
          existingSubcontractorFee: existingClient?.subcontractor_fee,
          legacySubcontractorFee: legacyLead.subcontractor_fee,
          existingMasterId: existingClient?.master_id,
          legacyMasterId: legacyLead.master_id,
          preservedProperties
        });

        // Transform legacy lead to match new lead structure
        const clientData = {
          ...legacyLead,
          ...preservedProperties, // Merge preserved properties
          id: `legacy_${legacyLead.id}`,
          lead_number: formatLegacyLeadNumber(legacyLead, subLeadSuffix),
          stage: String(legacyLead.stage || ''),
          source: String(legacyLead.source_id || ''),
          created_at: legacyLead.cdate,
          updated_at: legacyLead.udate,
          notes: legacyLead.notes || '',
          special_notes: legacyLead.special_notes || '',
          next_followup: legacyLead.next_followup || '',
          probability: String(legacyLead.probability || ''),
          // Use preserved category if available, otherwise use ID
          category: preservedProperties.category || String(legacyLead.category_id || legacyLead.category || ''),
          // Use preserved language if available, otherwise use ID
          language: preservedProperties.language || String(legacyLead.language_id || ''),
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
          clientId: clientData.id,
          language: clientData.language,
          category: clientData.category,
          total_base: clientData.total_base,
          total: clientData.total,
          subcontractor_fee: clientData.subcontractor_fee,
          master_id: clientData.master_id
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
          // Preserve category name from existing state if available (since DB might only have ID)
          category: selectedClient?.category || data.category || '',
          // Explicitly spread nested objects/arrays to ensure new references
          emails: data.emails ? [...(Array.isArray(data.emails) ? data.emails : [])] : []
        };
        console.log('🔄 Setting selectedClient with fresh data:', {
          currency_id: newClientData.currency_id,
          currency_iso_code: currencyData?.iso_code,
          currency_symbol: currencySymbol,
          balance: newClientData.balance,
          category: newClientData.category
        });
        setSelectedClient(newClientData);
        console.log('✅ setSelectedClient called with new data, currency_id:', newClientData.currency_id, 'currency_symbol:', currencySymbol);
      }
    } catch (error) {
      console.error('Error refreshing client data:', error);
    }
  }, []);

  // Memoized callbacks for Header and Sidebar to prevent unnecessary re-renders
  const handleMenuClick = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const handleSearchClick = useCallback(() => {
    setIsSearchOpen(prev => !prev);
  }, []);

  const handleOpenAIChat = useCallback(() => {
    setIsAiChatOpen(true);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleOpenEmailThread = useCallback(() => {
    setIsEmailThreadOpen(true);
  }, []);

  const handleOpenWhatsApp = useCallback(() => {
    setIsWhatsAppOpen(true);
  }, []);

  const handleOpenWhatsAppForContact = useCallback((payload: WhatsAppModalSelectedContact) => {
    setSelectedContactForThread(payload);
    setIsWhatsAppOpen(true);
  }, []);

  const handleOpenMessaging = useCallback(() => {
    setIsMessagingOpen(true);
  }, []);

  const handleCloseMessaging = useCallback(() => {
    setIsMessagingOpen(false);
    setRmqInitialConversationId(undefined);
    setRmqInitialScrollToMessageId(undefined);
  }, []);

  useEffect(() => {
    const onOpenRmqMessage = (e: Event) => {
      const ce = e as CustomEvent<{ conversationId: number; messageId: number }>;
      const d = ce.detail;
      if (d == null || typeof d.conversationId !== 'number') return;
      setRmqInitialConversationId(d.conversationId);
      setRmqInitialScrollToMessageId(typeof d.messageId === 'number' ? d.messageId : undefined);
      setIsMessagingOpen(true);
    };
    window.addEventListener('rmq:open-conversation-message', onOpenRmqMessage as EventListener);
    return () => window.removeEventListener('rmq:open-conversation-message', onOpenRmqMessage as EventListener);
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
      <Route path="/login" element={<RouteSuspense><LazyLoginPage /></RouteSuspense>} />
      <Route path="/about" element={<RouteSuspense><LazyAboutPage /></RouteSuspense>} />
      <Route path="/contact" element={<RouteSuspense><LazyContactPage /></RouteSuspense>} />
      <Route path="/how-it-works" element={<RouteSuspense><LazyHowItWorksPage /></RouteSuspense>} />
      <Route path="/public-contract/:contractId/:token" element={<RouteSuspense><LazyPublicContractView /></RouteSuspense>} />
      <Route path="/public-legacy-contract/:contractId/:token" element={<RouteSuspense><LazyPublicLegacyContractView /></RouteSuspense>} />
      <Route path="/payment/:token" element={<RouteSuspense><LazyPaymentPage /></RouteSuspense>} />
      <Route path="/cti/pop" element={<RouteSuspense><LazyCTIPopupPage /></RouteSuspense>} />
      <Route path="/my-profile/:employeeId" element={<RouteSuspense><LazyPublicProfilePage /></RouteSuspense>} />
      <Route path="/business-card/:employeeId" element={<RouteSuspense><LazyBusinessCardPage /></RouteSuspense>} />
      <Route path="/documents" element={
        <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-white">
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
                        <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
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
                          <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
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
                          <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
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
                            <path fill="currentColor" d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
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
            <main
              className="flex min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-gradient-to-br from-blue-800 via-blue-900 to-blue-950"
              style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #1e3a8a 100%)' }}
            >
              <RouteSuspense>
                <LazyDocumentsPage />
              </RouteSuspense>
            </main>
          </div>
        </div>
      } />
      <Route path="/calls-ledger" element={
        <ProtectedRoute user={authUser}>
          <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-white">
            <Sidebar
              userName={userFullName || userName}
              userInitials={userInitials}
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
              onOpenAIChat={() => setIsAiChatOpen(true)}
              mobileOnly={true}
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
<main className="app-main-scroll min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-auto bg-white">
              <RouteSuspense>
                <LazyCallsLedgerPage />
              </RouteSuspense>
              </main>
            </div>
            <RMQMessagesPage
              isOpen={isMessagingOpen}
              onClose={handleCloseMessaging}
              initialConversationId={rmqInitialConversationId}
              initialScrollToMessageId={rmqInitialScrollToMessageId}
            />
          </div>
        </ProtectedRoute>

      } />
      <Route path="/my-profile" element={
        <ProtectedRoute user={authUser}>
          <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 bg-base-100">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Header
                onMenuClick={() => setIsSidebarOpen(prev => !prev)}
                onSearchClick={handleSearchClick}
                isSearchOpen={isSearchOpen}
                setIsSearchOpen={setIsSearchOpen}
                appJustLoggedIn={appJustLoggedIn}
                onOpenAIChat={handleOpenAIChat}
                onOpenEmailThread={handleOpenEmailThread}
                onOpenWhatsApp={handleOpenWhatsApp}
                onOpenMessaging={handleOpenMessaging}
                isMenuOpen={isSidebarOpen}
              />
              <main className="app-main-scroll min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-auto bg-white">
                <RouteSuspense>
                  <LazyMyProfilePage />
                </RouteSuspense>
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
              selectedContact={
                selectedContactForThread && !('leadOnly' in selectedContactForThread)
                  ? selectedContactForThread
                  : null
              }
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
              onClose={handleCloseMessaging}
              initialConversationId={rmqInitialConversationId}
              initialScrollToMessageId={rmqInitialScrollToMessageId}
            />
            <CTIPopupModal />
          </div>
        </ProtectedRoute >
      } />
      < Route
        path="/*"
        element={
          < ProtectedRoute user={authUser} >
            <div className={`flex h-[100dvh] max-h-[100dvh] min-h-0 bg-base-100 ${appJustLoggedIn ? 'fade-in' : ''}`}>
              {/* Always mount Sidebar so it does not reload when navigating; hide on full-width pages */}
              <div className={isSignedSalesPage || isCaseManagerPage || isContractPage ? 'hidden' : undefined}>
                <Sidebar
                  userName={sidebarUserName}
                  userInitials={userInitials}
                  isOpen={isSidebarOpen}
                  onClose={handleCloseSidebar}
                  onOpenAIChat={handleOpenAIChat}
                  mobileOnly={sidebarMobileOnly}
                />
              </div>
              <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100 ${!isAdminPage && !isReportsPage && !isSignedSalesPage && !isCaseManagerPage && !isContractPage ? 'md:pl-24' : ''}`}>
                <Header
                  onMenuClick={handleMenuClick}
                  onSearchClick={handleSearchClick}
                  isSearchOpen={isSearchOpen}
                  setIsSearchOpen={setIsSearchOpen}
                  appJustLoggedIn={appJustLoggedIn}
                  onOpenAIChat={handleOpenAIChat}
                  onOpenEmailThread={handleOpenEmailThread}
                  onOpenWhatsApp={handleOpenWhatsApp}
                  onOpenMessaging={handleOpenMessaging}
                  isMenuOpen={isSidebarOpen}
                />
                <main className={`app-main-scroll min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-auto ${showBottomNav ? 'main-with-bottom-nav-padding' : ''}`}>
                  <Routes>
                    <Route path="/" element={<HomeEntryPage />} />
                    <Route path="/external-home" element={<RouteSuspense><LazyExternalUserHomePage /></RouteSuspense>} />
                    <Route path="/clients" element={<RouteSuspense><LazyClients selectedClient={selectedClient} setSelectedClient={setSelectedClient} refreshClientData={refreshClientData} onOpenWhatsAppForContact={handleOpenWhatsAppForContact} /></RouteSuspense>} />
                    <Route path="/clients/:lead_number/contract" element={<RouteSuspense><LazyContractPage key="contract-lead" /></RouteSuspense>} />
                    <Route path="/contract/:contractId" element={<RouteSuspense><LazyContractPage key="contract-id" /></RouteSuspense>} />
                    <Route path="/clients/:lead_number/timeline" element={<RouteSuspense><LazyTimelinePage /></RouteSuspense>} />
                    <Route path="/clients/:lead_number/history" element={<RouteSuspense><LazyHistoryPage /></RouteSuspense>} />
                    <Route path="/clients/:lead_number/master" element={<RouteSuspense><LazyMasterLeadPage /></RouteSuspense>} />
                    <Route path="/clients/:lead_number/*" element={<RouteSuspense><LazyClients selectedClient={selectedClient} setSelectedClient={setSelectedClient} refreshClientData={refreshClientData} onOpenWhatsAppForContact={handleOpenWhatsAppForContact} /></RouteSuspense>} />
                    <Route path="/calendar" element={<RouteSuspense><LazyCalendarPage /></RouteSuspense>} />
                    <Route path="/outlook-calendar" element={<RouteSuspense><LazyOutlookCalendarPage /></RouteSuspense>} />
                    <Route path="/waiting-for-price-offer" element={<RouteSuspense><LazyWaitingForPriceOfferPage /></RouteSuspense>} />
                    <Route path="/expert" element={<RouteSuspense><LazyExpertPage /></RouteSuspense>} />
                    <Route path="/create" element={<RouteSuspense><LazyCreateNewLead /></RouteSuspense>} />
                    <Route path="/lead-search" element={<RouteSuspense><LazyLeadSearchPage /></RouteSuspense>} />
                    <Route path="/pipeline" element={<RouteSuspense><LazyPipelinePage /></RouteSuspense>} />
                    <Route path="/new-cases" element={<RouteSuspense><LazyNewCasesPage /></RouteSuspense>} />
                    <Route path="/new-handler-cases" element={<RouteSuspense><LazyNewHandlerCasesPage /></RouteSuspense>} />
                    <Route path="/handler-management" element={<RouteSuspense><LazyHandlerManagementPage /></RouteSuspense>} />
                    <Route path="/my-cases" element={<RouteSuspense><LazyMyCasesPage /></RouteSuspense>} />
                    <Route path="/retainer-handler-cases" element={<RouteSuspense><LazyRetainerHandlerCasesPage /></RouteSuspense>} />
                    <Route path="/case-manager" element={<RouteSuspense><LazyCaseManagerPageNew /></RouteSuspense>} />
                    <Route path="/case-manager/:caseId" element={<RouteSuspense><LazyCaseDetailsPage /></RouteSuspense>} />
                    <Route path="/double-leads" element={<RouteSuspense><LazyDoubleLeadsPage /></RouteSuspense>} />
                    <Route path="/admin" element={<RouteSuspense><LazyAdminPage /></RouteSuspense>} />
                    <Route path="/teams" element={<RouteSuspense><LazyTeamsPage /></RouteSuspense>} />
                    <Route path="/employee-performance" element={<RouteSuspense><LazyEmployeePerformancePage /></RouteSuspense>} />
                    <Route path="/scheduler-tool" element={<RouteSuspense><LazySchedulerToolPage /></RouteSuspense>} />
                    <Route path="/whatsapp" element={<RouteSuspense><LazyWhatsAppPage /></RouteSuspense>} />
                    <Route path="/whatsapp-leads" element={<RouteSuspense><LazyWhatsAppLeadsPage /></RouteSuspense>} />
                    <Route path="/email-leads" element={<RouteSuspense><LazyEmailThreadLeadPage /></RouteSuspense>} />
                    <Route path="/collection" element={<RouteSuspense><LazyCollectionPage /></RouteSuspense>} />
                    <Route path="/performance" element={<RouteSuspense><LazyMyPerformancePage /></RouteSuspense>} />
                    <Route path="/proforma/:id" element={<RouteSuspense><LazyProformaViewPage /></RouteSuspense>} />
                    <Route path="/proforma/create/:paymentId" element={<RouteSuspense><LazyProformaCreatePage /></RouteSuspense>} />
                    <Route path="/proforma-legacy/:id" element={<RouteSuspense><LazyProformaLegacyViewPage /></RouteSuspense>} />
                    <Route path="/proforma-legacy/create/:leadId" element={<RouteSuspense><LazyProformaLegacyCreatePage /></RouteSuspense>} />
                    <Route path="/reports" element={<RouteSuspense><LazyReportsPage /></RouteSuspense>} />
                    <Route path="/reports/collection-finances" element={<RouteSuspense><LazyCollectionFinancesReport /></RouteSuspense>} />
                    <Route path="/reports/collection-due" element={<RouteSuspense><LazyCollectionDueReportPage /></RouteSuspense>} />
                    <Route path="/reports/closer-super-pipeline" element={<RouteSuspense><LazyCloserSuperPipelinePage /></RouteSuspense>} />
                    <Route path="/reports/sales-contribution" element={<RouteSuspense><LazySalesContributionPage /></RouteSuspense>} />
                    <Route path="/reports/edit-contracts" element={<RouteSuspense><LazyEditContractsPage /></RouteSuspense>} />
                    <Route path="/reports/reassign-leads" element={<RouteSuspense><LazyReassignLeadsPage /></RouteSuspense>} />
                    <Route path="/reports/employee-unavailabilities" element={<RouteSuspense><LazyEmployeeUnavailabilitiesReport /></RouteSuspense>} />
                    <Route path="/reports/employee-salaries" element={<RouteSuspense><LazyEmployeeSalariesReport /></RouteSuspense>} />
                    <Route path="/reports/employee-info" element={<RouteSuspense><LazyEmployeeInfoReport /></RouteSuspense>} />
                    <Route path="/reports/leads-report" element={<RouteSuspense><LazyLeadsReportPage /></RouteSuspense>} />
                    <Route path="/reports/tags-manager" element={<RouteSuspense><LazyTagsManagerPage /></RouteSuspense>} />
                    <Route path="/access-logs" element={<RouteSuspense><LazyExternalUserAccessLogsPage /></RouteSuspense>} />
                    <Route path="/external-settings" element={<RouteSuspense><LazyExternalUserSettingsPage /></RouteSuspense>} />
                    <Route path="/sales/signed" element={<RouteSuspense><LazySignedSalesReportPage /></RouteSuspense>} />
                    <Route path="/settings" element={<RouteSuspense><LazySettingsPage /></RouteSuspense>} />
                    <Route path="/test-meeting-summary" element={<RouteSuspense><LazyMeetingSummaryTestPage /></RouteSuspense>} />
                    <Route path="/simple-test" element={<RouteSuspense><LazySimpleTestPage /></RouteSuspense>} />
                    <Route path="/debug-test" element={<RouteSuspense><LazyDebugTestPage /></RouteSuspense>} />
                  </Routes>
                </main>
              </div>
              <MobileBottomNav
                onOpenMessaging={handleOpenMessaging}
                onOpenWhatsApp={handleOpenWhatsApp}
                onOpenEmailThread={handleOpenEmailThread}
              />
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
                selectedContact={
                  selectedContactForThread && !('leadOnly' in selectedContactForThread)
                    ? selectedContactForThread
                    : null
                }
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
                onClose={handleCloseMessaging}
                initialConversationId={rmqInitialConversationId}
                initialScrollToMessageId={rmqInitialScrollToMessageId}
              />
              {/* CTI Popup Modal - shows on any authenticated page when phone parameter is present */}
              <CTIPopupModal />
            </div>
          </ProtectedRoute >
        }
      />
    </Routes >
  );
};

const AppContent: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MailboxReconnectProvider>
          <CelebrationProvider>
            <Router>
              <ScrollRestoration />
              <AppContentInner />
              <MoneyRainCelebration />
              <MailboxReconnectModal />
              <PWAUpdateNotification />
              <Toaster
                position="top-center"
                reverseOrder={false}
              />
            </Router>
          </CelebrationProvider>
        </MailboxReconnectProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

const App: React.FC = () => {
  return <AppContent />;
};

export default App;
