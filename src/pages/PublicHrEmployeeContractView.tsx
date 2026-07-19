import React from 'react';
import PublicContractView from './PublicContractView';

/**
 * Public signing page for HR employee digital contracts.
 * Reuses PublicContractView in employee mode (no lead stage updates).
 */
const PublicHrEmployeeContractView: React.FC = () => {
  return <PublicContractView employeeMode />;
};

export default PublicHrEmployeeContractView;
