import React, { createContext, useContext, useState, ReactNode } from 'react';

interface CelebrationData {
  employeeName: string;
  employeeId: number | null;
}

interface CelebrationContextType {
  showCelebration: (data: CelebrationData) => void;
  celebrationData: CelebrationData | null;
  isCelebrating: boolean;
  closeCelebration: () => void;
}

const CelebrationContext = createContext<CelebrationContextType | undefined>(undefined);

export const useCelebration = () => {
  const context = useContext(CelebrationContext);
  if (!context) {
    throw new Error('useCelebration must be used within a CelebrationProvider');
  }
  return context;
};

interface CelebrationProviderProps {
  children: ReactNode;
}

export const CelebrationProvider: React.FC<CelebrationProviderProps> = ({ children }) => {
  const [celebrationData, setCelebrationData] = useState<CelebrationData | null>(null);
  const [isCelebrating, setIsCelebrating] = useState(false);

  const showCelebration = (data: CelebrationData) => {
    setCelebrationData(data);
    setIsCelebrating(true);
    
    // Auto-close after 8 seconds
    setTimeout(() => {
      closeCelebration();
    }, 8000);
  };

  const closeCelebration = () => {
    setIsCelebrating(false);
    setTimeout(() => {
      setCelebrationData(null);
    }, 500); // Wait for fade-out animation
  };

  return (
    <CelebrationContext.Provider
      value={{
        showCelebration,
        celebrationData,
        isCelebrating,
        closeCelebration,
      }}
    >
      {children}
    </CelebrationContext.Provider>
  );
};

