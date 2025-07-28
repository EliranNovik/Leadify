import React from 'react';
import { Navigate } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  const { instance } = useMsal();
  const msalAccount = instance.getActiveAccount();
  if (!user && !msalAccount) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

export default ProtectedRoute; 