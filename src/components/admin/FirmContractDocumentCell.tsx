import React from 'react';
import FirmColumnDocumentCell from './FirmColumnDocumentCell';
import type { FirmDocumentColumn } from '../../lib/firmColumnDocuments';

const FirmContractDocumentCell: React.FC<{
  storagePath?: string | null;
  column?: FirmDocumentColumn;
}> = ({ storagePath, column }) => {
  const resolved: FirmDocumentColumn =
    column ?? (storagePath?.includes('/contract_2/') ? 'contract_2' : 'contract');
  return <FirmColumnDocumentCell storagePath={storagePath} column={resolved} linkLabel="Contract" />;
};

export default FirmContractDocumentCell;
