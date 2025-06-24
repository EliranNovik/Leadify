import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Clients from './components/Clients';
import Meetings from './components/Meetings';
import Dashboard from './components/Dashboard';
import CreateNewLead from './components/CreateNewLead';
import CalendarPage from './components/CalendarPage';
import ExpertPage from './components/ExpertPage';

interface AppRoutesProps {
  selectedClient: any;
  setSelectedClient: React.Dispatch<any>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  refreshClientData: (clientId: number) => Promise<void>;
}

const AppRoutes: React.FC<AppRoutesProps> = (props) => (
  <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/meetings" element={<Meetings />} />
    <Route path="/clients/:lead_number" element={<Clients {...props} />} />
    <Route path="/clients" element={<Clients {...props} />} />
    <Route path="/create" element={<CreateNewLead />} />
    <Route path="/calendar" element={<CalendarPage />} />
    <Route path="/pipeline" element={<div>Pipeline</div>} />
    <Route path="/collection" element={<div>Collection</div>} />
    <Route path="/expert" element={<ExpertPage />} />
    <Route path="/qa" element={<div>QA</div>} />
    <Route path="/settings" element={<div>Settings</div>} />
    {/* Add other routes from your sidebar here */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default AppRoutes; 