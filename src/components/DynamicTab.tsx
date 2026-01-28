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
      <div style={{ height: isExpanded ? '120px' : '60px', width: '100%' }} />

      {/* Fixed bottom tab */}
      <div
        style={{
          position: 'fixed',
          bottom: '10px',
          left: '50%',
          transform: isVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(150%)',
          zIndex: 9999,
          borderRadius: '50px',
          background: 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          padding: isExpanded ? '12px 24px' : '8px 24px',
          minWidth: isExpanded ? 'auto' : '280px',
          transition: 'all 0.3s ease',
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? 'auto' : 'none',
        }}
        className={`dynamic-tab-container md:max-w-[900px] md:px-10 ${isExpanded ? 'md:py-8' : 'md:py-6'} w-[calc(100%-20px)] md:w-auto`}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}
          className="md:gap-6">
          {/* Income Field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
            className="md:gap-3">
            <label style={{ fontSize: '10px', fontWeight: '500', color: '#374151' }}
              className="md:text-base md:font-semibold">Income</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              className="md:gap-2">
              <input
                type="text"
                style={{
                  width: '90px',
                  padding: '4px 6px',
                  border: '1px solid rgba(209, 213, 219, 0.5)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  background: 'rgba(255, 255, 255, 0.9)',
                }}
                className="md:w-[180px] md:px-4 md:py-3 md:text-lg"
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
              <span style={{ fontSize: '13px', color: '#6b7280' }}
                className="md:text-lg dynamic-tab-currency">₪</span>
            </div>
          </div>

          {/* Due Normalized Field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
            className="md:gap-3">
            <label style={{ fontSize: '10px', fontWeight: '500', color: '#374151' }}
              className="md:text-base md:font-semibold">Due Norm %</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              className="md:gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                style={{
                  width: '70px',
                  padding: '4px 6px',
                  border: '1px solid rgba(209, 213, 219, 0.5)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  background: 'rgba(255, 255, 255, 0.9)',
                  MozAppearance: 'textfield',
                  appearance: 'textfield',
                }}
                className="md:w-[140px] md:px-4 md:py-3 md:text-lg"
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
              <span style={{ fontSize: '13px', color: '#6b7280' }}
                className="md:text-lg dynamic-tab-percent">%</span>
            </div>
          </div>

          {/* Role Percentages - Collapsible */}
          {!isExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
              className="md:gap-3">
              <label style={{ fontSize: '10px', fontWeight: '500', color: '#374151' }}
                className="md:text-base md:font-semibold">Roles</label>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                  width: '28px',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: '50%',
                  transition: 'background 0.2s',
                }}
                className="md:w-14 md:h-14"
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
                title="Show role percentages"
              >
                <EyeIcon style={{ width: '16px', height: '16px', color: '#374151' }}
                  className="md:w-8 md:h-8" />
              </button>
            </div>
          )}

          {/* Role Percentage Inputs - Shown when expanded */}
          {isExpanded && (
            <>
              {roleNames.map(({ role, label }) => (
                <div key={role} style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
                  className="md:gap-3">
                  <label style={{ fontSize: '10px', fontWeight: '500', color: '#374151' }}
                    className="md:text-base md:font-semibold">{label}</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    className="md:gap-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      style={{
                        width: '60px',
                        padding: '4px 6px',
                        border: '1px solid rgba(209, 213, 219, 0.5)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        textAlign: 'right',
                        background: 'rgba(255, 255, 255, 0.9)',
                        MozAppearance: 'textfield',
                        appearance: 'textfield',
                      }}
                      className="md:w-[120px] md:px-4 md:py-3 md:text-lg"
                      onWheel={(e) => e.currentTarget.blur()}
                      value={tempRolePercentages.get(role) || rolePercentages.get(role)?.toString() || '0'}
                      onChange={(e) => {
                        const value = e.target.value;
                        const updated = new Map(tempRolePercentages);
                        updated.set(role, value);
                        setTempRolePercentages(updated);
                      }}
                      placeholder="0"
                    />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}
                      className="md:text-lg dynamic-tab-percent">%</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* Hide Roles Button (shown when expanded) and Save Button */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}
            className="md:gap-4">
            {/* Hide Roles Button - only shown when expanded */}
            {isExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
                className="md:gap-3">
                <label style={{ fontSize: '10px', fontWeight: '500', opacity: 0 }}
                  className="md:text-base">Hide</label>
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  style={{
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderRadius: '50%',
                    transition: 'background 0.2s',
                  }}
                  className="md:w-14 md:h-14"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                  title="Hide role percentages"
                >
                  <EyeSlashIcon style={{ width: '16px', height: '16px', color: '#374151' }}
                    className="md:w-8 md:h-8" />
                </button>
              </div>
            )}

            {/* Save Button */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}
              className="md:gap-3">
              <label style={{ fontSize: '10px', fontWeight: '500', opacity: 0 }}
                className="md:text-base">Save</label>
              <button
                onClick={handleSave}
                disabled={savingSettings || savingRolePercentages || loadingRolePercentages}
                style={{
                  width: '28px',
                  height: '28px',
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
                className="md:w-16 md:h-16"
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
                      width: '14px',
                      height: '14px',
                      border: '2px solid white',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                    className="md:w-[24px] md:h-[24px] md:border-[3px]"
                  />
                ) : (
                  <CheckIcon style={{ width: '16px', height: '16px' }}
                    className="md:w-8 md:h-8" />
                )}
              </button>
            </div>
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
        
        /* Desktop overrides for DynamicTab - make everything bigger */
        @media (min-width: 768px) {
          /* Income input - target by placeholder */
          .dynamic-tab-container input[placeholder="Income"] {
            width: 180px !important;
            padding: 10px 14px !important;
            font-size: 16px !important;
          }
          
          /* Due Norm % input - target by placeholder */
          .dynamic-tab-container input[placeholder="0.00"] {
            width: 140px !important;
            padding: 10px 14px !important;
            font-size: 16px !important;
          }
          
          /* Role percentage inputs - target by placeholder="0" */
          .dynamic-tab-container input[placeholder="0"] {
            width: 120px !important;
            padding: 10px 14px !important;
            font-size: 16px !important;
          }
          
          /* All labels in dynamic tab */
          .dynamic-tab-container > div > div > label {
            font-size: 14px !important;
            font-weight: 600 !important;
          }
          
          /* Eye icon button - target by title containing "role" */
          .dynamic-tab-container button[title*="role"] {
            width: 48px !important;
            height: 48px !important;
          }
          
          /* Eye icons inside button */
          .dynamic-tab-container button[title*="role"] svg {
            width: 28px !important;
            height: 28px !important;
          }
          
          /* Save button - target by title */
          .dynamic-tab-container button[title="Save all settings"] {
            width: 56px !important;
            height: 56px !important;
          }
          
          /* Save button icon and spinner */
          .dynamic-tab-container button[title="Save all settings"] svg,
          .dynamic-tab-container button[title="Save all settings"] > div {
            width: 28px !important;
            height: 28px !important;
          }
          
          /* Currency and percentage symbols */
          .dynamic-tab-container .dynamic-tab-currency,
          .dynamic-tab-container .dynamic-tab-percent {
            font-size: 16px !important;
          }
        }
      `}</style>
    </>
  );
};

export default DynamicTab;
