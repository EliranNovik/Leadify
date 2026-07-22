import React from 'react';
import { useParams } from 'react-router-dom';
import ContractPage from '../components/ContractPage';

/** HR staff editor for recruitment (user) digital contracts. */
const HrRecruitmentContractPage: React.FC = () => {
  const { userId, contractId } = useParams<{ userId: string; contractId: string }>();

  return (
    <ContractPage
      mode="recruitment"
      userIdOverride={userId}
      contractIdOverride={contractId}
    />
  );
};

export default HrRecruitmentContractPage;
