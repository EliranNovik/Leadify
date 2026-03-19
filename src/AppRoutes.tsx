import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PageLoader from './components/PageLoader';
import {
  LazyAdminPage,
  LazyCalendarPage,
  LazyClients,
  LazyCreateNewLead,
  LazyCTIPopupModal,
  LazyDashboard,
  LazyExpertPage,
  LazyMeetingSummaryTestPage,
  LazyMeetings,
  LazyPipelinePage,
  LazyProformaViewPage,
  LazyPublicContractView,
  LazyPublicLegacyContractView,
  LazyReportsPage,
  LazySignedSalesReportPage,
  LazyTeamsPage,
  LazyWhatsAppPage,
} from './routes/lazyPages';

function RouteSuspense({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

interface AppRoutesProps {
  selectedClient: any;
  setSelectedClient: React.Dispatch<any>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  refreshClientData: (clientId: number | string) => Promise<void>;
}

/** Legacy / alternate route table — kept in sync with lazy chunks (main app routes live in App.tsx). */
const AppRoutes: React.FC<AppRoutesProps> = (props) => (
  <>
    <Routes>
      <Route path="/" element={<RouteSuspense><LazyDashboard /></RouteSuspense>} />
      <Route path="/meetings" element={<RouteSuspense><LazyMeetings /></RouteSuspense>} />
      <Route
        path="/clients/:lead_number"
        element={
          <RouteSuspense>
            <LazyClients {...props} />
          </RouteSuspense>
        }
      />
      <Route
        path="/clients"
        element={
          <RouteSuspense>
            <LazyClients {...props} />
          </RouteSuspense>
        }
      />
      <Route path="/create" element={<RouteSuspense><LazyCreateNewLead /></RouteSuspense>} />
      <Route path="/calendar" element={<RouteSuspense><LazyCalendarPage /></RouteSuspense>} />
      <Route path="/pipeline" element={<RouteSuspense><LazyPipelinePage /></RouteSuspense>} />
      <Route path="/collection" element={<div>Collection</div>} />
      <Route path="/expert" element={<RouteSuspense><LazyExpertPage /></RouteSuspense>} />
      <Route path="/qa" element={<div>QA</div>} />
      <Route path="/settings" element={<div>Settings</div>} />
      <Route path="/admin" element={<RouteSuspense><LazyAdminPage /></RouteSuspense>} />
      <Route path="/teams" element={<RouteSuspense><LazyTeamsPage /></RouteSuspense>} />
      <Route path="/whatsapp" element={<RouteSuspense><LazyWhatsAppPage /></RouteSuspense>} />
      <Route path="/proforma/:id" element={<RouteSuspense><LazyProformaViewPage /></RouteSuspense>} />
      <Route path="/reports" element={<RouteSuspense><LazyReportsPage /></RouteSuspense>} />
      <Route path="/sales/signed" element={<RouteSuspense><LazySignedSalesReportPage /></RouteSuspense>} />
      <Route path="/public-contract/:contractId/:token" element={<RouteSuspense><LazyPublicContractView /></RouteSuspense>} />
      <Route path="/public-legacy-contract/:contractId/:token" element={<RouteSuspense><LazyPublicLegacyContractView /></RouteSuspense>} />
      <Route path="/test-meeting-summary" element={<RouteSuspense><LazyMeetingSummaryTestPage /></RouteSuspense>} />
      <Route path="/cti/pop" element={<RouteSuspense><LazyCTIPopupModal /></RouteSuspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <RouteSuspense>
      <LazyCTIPopupModal />
    </RouteSuspense>
  </>
);

export default AppRoutes;
