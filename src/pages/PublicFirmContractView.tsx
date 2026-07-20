import React from 'react';
import PublicContractView from './PublicContractView';

/**
 * Public signing page for external firm digital contracts.
 * Reuses PublicContractView in firm mode (no lead stage updates).
 */
const PublicFirmContractView: React.FC = () => {
  return <PublicContractView firmMode />;
};

export default PublicFirmContractView;
