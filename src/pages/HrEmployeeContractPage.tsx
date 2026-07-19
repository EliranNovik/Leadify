import React from 'react';
import { useParams } from 'react-router-dom';
import ContractPage from '../components/ContractPage';

/**
 * HR staff editor for employee digital contracts.
 * Reuses ContractPage in employee mode.
 */
const HrEmployeeContractPage: React.FC = () => {
  const { employeeId, contractId } = useParams<{ employeeId: string; contractId: string }>();
  const empId = Number(employeeId);

  return (
    <ContractPage
      mode="employee"
      employeeIdOverride={Number.isFinite(empId) ? empId : undefined}
      contractIdOverride={contractId}
    />
  );
};

export default HrEmployeeContractPage;
