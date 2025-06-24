import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute: React.FC<{ user: any; children: React.ReactNode }> = ({ user, children }) => {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

export default ProtectedRoute; 