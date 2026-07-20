import React from 'react';
import { useParams } from 'react-router-dom';
import ContractPage from '../components/ContractPage';

/**
 * Staff editor for external firm digital contracts.
 * Reuses ContractPage in firm mode.
 */
const ExternalFirmContractPage: React.FC = () => {
  const { firmId, contractId } = useParams<{ firmId: string; contractId: string }>();

  return (
    <ContractPage
      mode="firm"
      firmIdOverride={firmId}
      contractIdOverride={contractId}
    />
  );
};

export default ExternalFirmContractPage;
