import React, { createContext, useContext } from 'react';
import type { PortalLeadSummary } from '../../../lib/portalApi';
import { usePortalTabCache, type PortalTabCacheState } from '../hooks/usePortalTabCache';

const PortalTabDataContext = createContext<PortalTabCacheState | null>(null);

type Props = {
  leadRef: string | null | undefined;
  leadSummary: PortalLeadSummary | null;
  children: React.ReactNode;
};

export const PortalTabDataProvider: React.FC<Props> = ({ leadRef, leadSummary, children }) => {
  const value = usePortalTabCache(leadRef, leadSummary);
  return <PortalTabDataContext.Provider value={value}>{children}</PortalTabDataContext.Provider>;
};

export function usePortalTabData(): PortalTabCacheState {
  const ctx = useContext(PortalTabDataContext);
  if (!ctx) {
    throw new Error('usePortalTabData must be used within PortalTabDataProvider');
  }
  return ctx;
}

export function usePortalTabDataOptional(): PortalTabCacheState | null {
  return useContext(PortalTabDataContext);
}
