import React from 'react';
import CollectionFinancesReport from '../../pages/CollectionFinancesReport';
import type { CollectionFinancesRailBridge } from './collectionFinancesRailBridge';
import type { FinanceCollectionFocusId } from '../../lib/financeCollectionFocus';

type FinanceCollectionTabProps = {
  onRailBridgeChange?: (bridge: CollectionFinancesRailBridge | null) => void;
  focusPreset?: FinanceCollectionFocusId | null;
};

/** Collection report tab inside Finance Management. */
const FinanceCollectionTab: React.FC<FinanceCollectionTabProps> = ({
  onRailBridgeChange,
  focusPreset = null,
}) => (
  <CollectionFinancesReport
    hideSideRail
    onRailBridgeChange={onRailBridgeChange}
    focusPreset={focusPreset}
  />
);

export default FinanceCollectionTab;
