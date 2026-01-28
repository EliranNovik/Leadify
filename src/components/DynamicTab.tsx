import React, { useState, useEffect } from 'react';
import { CheckIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

interface DynamicTabProps {
  totalIncome: number;
  setTotalIncome: (value: number) => void;
  dueNormalizedPercentage: number;
  setDueNormalizedPercentage: (value: number) => void;
  rolePercentages: Map<string, number>;
  setRolePercentages: (value: Map<string, number>) => void;
  tempRolePercentages: Map<string, string>;
  setTempRolePercentages: (value: Map<string, string>) => void;
  onSaveSettings: () => Promise<void>;
  onSaveRolePercentages: () => Promise<void>;
  savingSettings: boolean;
  savingRolePercentages: boolean;
  loadingRolePercentages: boolean;
  fetchRolePercentages: () => Promise<void>;
  isDynamicIslandOpen: boolean;
}

const DynamicTab: React.FC<DynamicTabProps> = ({
  totalIncome,
  setTotalIncome,
  dueNormalizedPercentage,
  setDueNormalizedPercentage,
  rolePercentages,
  setRolePercentages,
  tempRolePercentages,
  setTempRolePercentages,
  onSaveSettings,
  onSaveRolePercentages,
  savingSettings,
  savingRolePercentages,
  loadingRolePercentages,
  fetchRolePercentages,
  isDynamicIslandOpen,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Hide tab when DynamicIsland is open, show when closed
  useEffect(() => {
    setIsVisible(!isDynamicIslandOpen);
  }, [isDynamicIslandOpen]);

  // Initialize tempRolePercentages
  useEffect(() => {
    if (rolePercentages.size > 0) {
      const tempMap = new Map<string, string>();
      rolePercentages.forEach((value, key) => {
        tempMap.set(key, value.toString());
      });
      const allRoles = ['CLOSER', 'SCHEDULER', 'MANAGER', 'EXPERT', 'HANDLER', 'CLOSER_WITH_HELPER', 'HELPER_CLOSER', 'HELPER_HANDLER', 'DEPARTMENT_MANAGER'];
      allRoles.forEach(role => {
        if (!tempMap.has(role)) {
          tempMap.set(role, '0');
        }
      });
      setTempRolePercentages(tempMap);
    }
  }, [rolePercentages, setTempRolePercentages]);

  // Fetch role percentages when expanded
  useEffect(() => {
    if (isExpanded && rolePercentages.size === 0) {
      fetchRolePercentages();
    }
  }, [isExpanded, rolePercentages.size, fetchRolePercentages]);

  const handleSave = async () => {
    try {
      await onSaveSettings();
      await onSaveRolePercentages();
    } catch (error) {
      // Error handling is done in the save functions
    }
  };

  const roleNames = [
    { role: 'CLOSER', label: 'Closer' },
    { role: 'CLOSER_WITH_HELPER', label: 'Closer (w/ Helper)' },
    { role: 'HELPER_CLOSER', label: 'Helper Closer' },
    { role: 'SCHEDULER', label: 'Scheduler' },
    { role: 'MANAGER', label: 'Manager' },
    { role: 'EXPERT', label: 'Expert' },
    { role: 'HANDLER', label: 'Handler' },
    { role: 'HELPER_HANDLER', label: 'Helper Handler' },
    { role: 'DEPARTMENT_MANAGER', label: 'Dept Manager' },
  ];

  return (
    <>
      {/* Spacer to ensure page is scrollable past the tab */}
      <div style={{ height: isExpanded ? '200px' : '80px', width: '100%' }} />
      
      {/* Fixed bottom tab */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: isVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(150%)',
          zIndex: 9999,
          borderRadius: '50px',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          padding: isExpanded ? '16px 24px' : '12px 20px',
          minWidth: isExpanded ? 'auto' : '300px',
          maxWidth: '95%',
          transition: 'all 0.3s ease',
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? 'auto' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Income Field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: '500', color: '#374151' }}>Income</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text"
                style={{
                  width: '100px',
                  padding: '6px 8px',
                  border: '1px solid rgba(209, 213, 219, 0.5)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  background: 'rgba(255, 255, 255, 0.9)',
                }}
                value={totalIncome !== null && totalIncome !== undefined && totalIncome > 0
                  ? totalIncome.toLocaleString('en-US')
                  : ''}
                onChange={(e) => {
                  const rawValue = e.target.value.replace(/[^\d]/g, '');
                  if (rawValue === '') {
                    setTotalIncome(0);
                  } else {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue) && numValue >= 0) {
                      setTotalIncome(numValue);
                    }
                  }
                }}
                onBlur={(e) => {
                  if (totalIncome && totalIncome > 0) {
                    e.target.value = totalIncome.toLocaleString('en-US');
                  }
                }}
                onFocus={(e) => {
                  if (totalIncome && totalIncome > 0) {
                    e.target.value = totalIncome.toString();
                  }
                }}
                placeholder="Income"
              />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>₪</span>
            </div>
          </div>

          {/* Due Normalized Field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: '500', color: '#374151' }}>Due Norm %</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                style={{
                  width: '80px',
                  padding: '6px 8px',
                  border: '1px solid rgba(209, 213, 219, 0.5)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  background: 'rgba(255, 255, 255, 0.9)',
                  MozAppearance: 'textfield',
                  appearance: 'textfield',
                }}
                onWheel={(e) => e.currentTarget.blur()}
                value={dueNormalizedPercentage !== null && dueNormalizedPercentage !== undefined
                  ? dueNormalizedPercentage.toString()
                  : ''}
                onChange={(e) => {
                  const rawValue = e.target.value;
                  if (rawValue === '') {
                    setDueNormalizedPercentage(0);
                  } else {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
                      setDueNormalizedPercentage(numValue);
                    }
                  }
                }}
                placeholder="0.00"
              />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>%</span>
            </div>
          </div>

          {/* Role Percentages - Collapsible */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: '500', color: '#374151' }}>Roles</label>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: '50%',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              title={isExpanded ? "Hide role percentages" : "Show role percentages"}
            >
              {isExpanded ? (
                <EyeSlashIcon style={{ width: '18px', height: '18px', color: '#374151' }} />
              ) : (
                <EyeIcon style={{ width: '18px', height: '18px', color: '#374151' }} />
              )}
            </button>
          </div>

          {/* Role Percentage Inputs - Shown when expanded */}
          {isExpanded && (
            <>
              {roleNames.map(({ role, label }) => (
                <div key={role} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: '500', color: '#374151' }}>{label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      style={{
                        width: '70px',
                        padding: '6px 8px',
                        border: '1px solid rgba(209, 213, 219, 0.5)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        textAlign: 'right',
                        background: 'rgba(255, 255, 255, 0.9)',
                        MozAppearance: 'textfield',
                        appearance: 'textfield',
                      }}
                      onWheel={(e) => e.currentTarget.blur()}
                      value={tempRolePercentages.get(role) || rolePercentages.get(role)?.toString() || '0'}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTempRolePercentages(prev => {
                          const updated = new Map(prev);
                          updated.set(role, value);
                          return updated;
                        });
                      }}
                      placeholder="0"
                    />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>%</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Save Button */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
            <label style={{ fontSize: '11px', fontWeight: '500', opacity: 0 }}>Save</label>
            <button
              onClick={handleSave}
              disabled={savingSettings || savingRolePercentages || loadingRolePercentages}
              style={{
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: savingSettings || savingRolePercentages || loadingRolePercentages ? '#a78bfa' : '#9333ea',
                color: 'white',
                cursor: savingSettings || savingRolePercentages || loadingRolePercentages ? 'not-allowed' : 'pointer',
                borderRadius: '50%',
                transition: 'all 0.2s',
                boxShadow: '0 2px 8px rgba(147, 51, 234, 0.3)',
              }}
              onMouseEnter={(e) => {
                if (!savingSettings && !savingRolePercentages && !loadingRolePercentages) {
                  e.currentTarget.style.background = '#7e22ce';
                  e.currentTarget.style.transform = 'scale(1.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (!savingSettings && !savingRolePercentages && !loadingRolePercentages) {
                  e.currentTarget.style.background = '#9333ea';
                  e.currentTarget.style.transform = 'scale(1)';
                }
              }}
              title="Save all settings"
            >
              {(savingSettings || savingRolePercentages) ? (
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid white',
                    borderTop: '2px solid transparent',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
              ) : (
                <CheckIcon style={{ width: '18px', height: '18px' }} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Add spin animation for loading spinner and hide number input arrows */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        /* Hide number input arrows */
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type="number"] {
          -moz-appearance: textfield;
        }
      `}</style>
    </>
  );
};

export default DynamicTab;
