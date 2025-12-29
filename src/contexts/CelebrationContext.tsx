import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { sendAgreementCelebrationNotification } from '../lib/pushNotificationService';

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

  const showCelebration = async (data: CelebrationData) => {
    setCelebrationData(data);
    setIsCelebrating(true);
    
    // Send push notification for signed agreement
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Send to the employee who signed (if they have push enabled)
        if (data.employeeId) {
          // Get user ID for the employee
          const { data: employeeUser, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('user_id')
            .eq('id', data.employeeId)
            .maybeSingle();
          
          if (employeeError) {
            console.warn('⚠️ Error fetching employee user_id for push notification:', employeeError);
          } else if (employeeUser?.user_id) {
            // Only send if user_id is a valid UUID string
            const userIdString = String(employeeUser.user_id);
            // Check if it's a valid UUID format (basic check)
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(userIdString)) {
              try {
                await sendAgreementCelebrationNotification(
                  userIdString,
                  data.employeeName,
                  data.employeeId
                );
              } catch (pushError) {
                console.warn('⚠️ Error sending push notification to employee:', pushError);
              }
            } else {
              console.warn('⚠️ Employee user_id is not a valid UUID, skipping push notification:', {
                employeeId: data.employeeId,
                userId: employeeUser.user_id,
                userIdType: typeof employeeUser.user_id,
              });
            }
          }
        }
        
        // Also send to current user if they have push enabled
        const pushEnabled = localStorage.getItem('pushNotifications') !== 'false';
        if (pushEnabled) {
          await sendAgreementCelebrationNotification(
            user.id,
            data.employeeName,
            data.employeeId
          );
        }
      }
    } catch (error) {
      console.error('Error sending push notification for celebration:', error);
      // Don't block celebration if push fails
    }
    
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

