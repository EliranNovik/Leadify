import React from 'react';
import CollectionDueReportPage from '../../pages/CollectionDueReportPage';
import type { FinanceCollectionFocusId } from '../../lib/financeCollectionFocus';

type FinanceCollectionDueTabProps = {
  focusPreset?: FinanceCollectionFocusId | null;
};

/** Collection Due report tab inside Finance Management. */
const FinanceCollectionDueTab: React.FC<FinanceCollectionDueTabProps> = ({ focusPreset = null }) => (
  <CollectionDueReportPage focusPreset={focusPreset} />
);

export default FinanceCollectionDueTab;
