import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon, ChartBarIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';

interface DynamicIslandProps {
  isOpen: boolean;
  onClose: () => void;
  totalIncome: number;
  setTotalIncome: (value: number) => void;
  dueNormalizedPercentage: number;
  setDueNormalizedPercentage: (value: number) => void;
  totalSignedValue: number;
  loadingSignedValue: boolean;
  formatCurrency: (amount: number) => string;
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
}

const DynamicIsland: React.FC<DynamicIslandProps> = ({
  isOpen,
  onClose,
  totalIncome,
  setTotalIncome,
  dueNormalizedPercentage,
  setDueNormalizedPercentage,
  totalSignedValue,
  loadingSignedValue,
  formatCurrency,
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
}) => {

  // Fetch role percentages when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchRolePercentages();
    }
  }, [isOpen, fetchRolePercentages]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-base-100 w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-base-300">
          <h2 className="text-3xl font-bold">Dynamic Island</h2>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Income and Due Normalized - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Income Section */}
              <div className="card bg-base-200 shadow-lg">
                <div className="card-body">
                  <h3 className="text-2xl font-bold mb-4">Income</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <label className="text-lg font-medium whitespace-nowrap">Income:</label>
                      <input
                        type="text"
                        className="input input-bordered input-lg flex-1"
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
                        placeholder="Enter income amount"
                      />
                      <span className="text-lg text-gray-600">₪</span>
                    </div>
                    {/* Total Signed Value */}
                    <div className="flex items-center gap-4 pt-2 border-t border-base-300">
                      <label className="text-lg font-medium whitespace-nowrap">Total Signed:</label>
                      <div className="px-4 py-2 bg-base-100 rounded-lg border border-base-300 flex-1 text-right">
                        {loadingSignedValue ? (
                          <span className="loading loading-spinner loading-sm"></span>
                        ) : (
                          <span className="font-semibold text-lg">{formatCurrency(totalSignedValue)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Due Normalized Percentage Section */}
              <div className="card bg-base-200 shadow-lg">
                <div className="card-body">
                  <h3 className="text-2xl font-bold mb-4">Due Normalized Percentage</h3>
                  <div className="flex items-center gap-4">
                    <label className="text-lg font-medium whitespace-nowrap">Due Normalized %:</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="input input-bordered input-lg flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                    <span className="text-lg text-gray-600">%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Role Percentages Section - Side by Side */}
            <div>
              <h3 className="text-2xl font-bold mb-4">Role Percentages Configuration</h3>
              <p className="text-sm text-gray-600 mb-6">
                Configure the percentage allocation for each role. Sales roles apply to signed amounts, Handler roles apply to due amounts. Expert appears in both sections but can only be edited in Handler section.
              </p>

              {loadingRolePercentages ? (
                <div className="flex justify-center py-8">
                  <span className="loading loading-spinner loading-lg"></span>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Sales Section */}
                  <div className="card bg-base-200 shadow-lg">
                    <div className="card-body">
                      <h4 className="text-xl font-bold mb-4 text-primary">Sales</h4>
                      <div className="space-y-3">
                        {[
                          { role: 'CLOSER', label: 'Closer', description: 'Percentage when Closer works alone (no Helper Closer)' },
                          { role: 'CLOSER_WITH_HELPER', label: 'Closer (with Helper)', description: 'Percentage when Helper Closer also exists' },
                          { role: 'HELPER_CLOSER', label: 'Helper Closer', description: 'Percentage when Helper Closer is assigned' },
                          { role: 'SCHEDULER', label: 'Scheduler', description: 'Meeting Scheduler percentage' },
                          { role: 'MANAGER', label: 'Meeting Manager', description: 'Meeting Manager percentage' },
                          { role: 'EXPERT', label: 'Expert', description: 'Expert percentage (read-only - edit in Handler section)', readOnly: true },
                        ].map(({ role, label, description, readOnly }) => (
                          <div key={role} className="flex items-center gap-4 p-4 bg-base-100 rounded-lg">
                            <div className="flex-1">
                              <label className="font-semibold text-sm">{label}</label>
                              <p className="text-xs text-gray-500 mt-1">{description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className="input input-bordered w-32 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={tempRolePercentages.get(role) || rolePercentages.get(role)?.toString() || '0'}
                                onChange={(e) => {
                                  if (!readOnly) {
                                    const value = e.target.value;
                                    setTempRolePercentages(prev => {
                                      const updated = new Map(prev);
                                      updated.set(role, value);
                                      return updated;
                                    });
                                  }
                                }}
                                placeholder="0"
                                disabled={readOnly}
                                readOnly={readOnly}
                              />
                              <span className="text-sm font-medium">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Handler Section */}
                  <div className="card bg-base-200 shadow-lg">
                    <div className="card-body">
                      <h4 className="text-xl font-bold mb-4 text-secondary">Handler</h4>
                      <div className="space-y-3">
                        {[
                          { role: 'HANDLER', label: 'Handler', description: 'Handler percentage applied to due amounts' },
                          { role: 'HELPER_HANDLER', label: 'Helper Handler', description: 'Helper Handler percentage applied to due amounts' },
                          { role: 'EXPERT', label: 'Expert', description: 'Expert percentage applied to due amounts (also applies to signed amounts)' },
                          { role: 'DEPARTMENT_MANAGER', label: 'Department Manager', description: 'Department Manager percentage' },
                        ].map(({ role, label, description }) => (
                          <div key={role} className="flex items-center gap-4 p-4 bg-base-100 rounded-lg">
                            <div className="flex-1">
                              <label className="font-semibold text-sm">{label}</label>
                              <p className="text-xs text-gray-500 mt-1">{description}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                className="input input-bordered w-32 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
                              <span className="text-sm font-medium">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-base-300 bg-base-100">
          <button
            onClick={onClose}
            className="btn btn-ghost"
            disabled={savingSettings || savingRolePercentages}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              try {
                await onSaveSettings();
                await onSaveRolePercentages();
                onClose();
              } catch (error) {
                // Error handling is done in the save functions
              }
            }}
            disabled={savingSettings || savingRolePercentages || loadingRolePercentages}
            className="btn btn-primary gap-2"
          >
            {(savingSettings || savingRolePercentages) ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Saving...
              </>
            ) : (
              <>
                <CheckIcon className="w-5 h-5" />
                Save All
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DynamicIsland;
