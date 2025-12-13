import React from 'react';
import CTIPopupModal from '../components/CTIPopupModal';

/**
 * Standalone page for CTI popup that can be accessed via direct URL
 * MicroSIP will open: /cti/pop?phone=972507825939
 */
const CTIPopupPage: React.FC = () => {
  return <CTIPopupModal />;
};

export default CTIPopupPage;
