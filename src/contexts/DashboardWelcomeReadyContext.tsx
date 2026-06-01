import React, { createContext, useCallback, useContext, useMemo } from 'react';

type DashboardWelcomeReadyContextValue = {
  reportDepartmentPerformanceReady: () => void;
};

const DashboardWelcomeReadyContext = createContext<DashboardWelcomeReadyContextValue | null>(null);

export function DashboardWelcomeReadyProvider({
  children,
  onReady,
}: {
  children: React.ReactNode;
  onReady: () => void;
}) {
  const reportDepartmentPerformanceReady = useCallback(() => {
    onReady();
  }, [onReady]);

  const value = useMemo(
    () => ({ reportDepartmentPerformanceReady }),
    [reportDepartmentPerformanceReady]
  );

  return (
    <DashboardWelcomeReadyContext.Provider value={value}>{children}</DashboardWelcomeReadyContext.Provider>
  );
}

export function useReportDashboardWelcomeReady(): (() => void) | undefined {
  return useContext(DashboardWelcomeReadyContext)?.reportDepartmentPerformanceReady;
}
