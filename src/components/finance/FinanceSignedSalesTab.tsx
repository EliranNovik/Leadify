import React from 'react';
import type { FinanceCollectionFocusId } from '../../lib/financeCollectionFocus';
import SignedSalesReportPage from '../../pages/SignedSalesReportPage';

/** Signed agreements report tab inside Finance Management. */
const FinanceSignedSalesTab: React.FC<{
  focusPreset?: FinanceCollectionFocusId | null;
}> = ({ focusPreset = null }) => (
  <SignedSalesReportPage embedded focusPreset={focusPreset} />
);

export default FinanceSignedSalesTab;
