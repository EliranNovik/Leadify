import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface UnassignedLead {
  id: string | number;
  name: string;
  lead_number?: string;
  isLegacy: boolean;
}

interface Handler {
  id: number;
  display_name: string;
  department?: string;
  newCasesCount?: number;
  activeCasesCount?: number;
}

interface Employee {
  id: number;
  display_name: string;
  photo_url?: string;
  photo?: string;
}

interface AssignMultipleLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  leads: UnassignedLead[];
  handlers: Handler[];
  onAssignComplete: () => void;
}

const AssignMultipleLeadsModal: React.FC<AssignMultipleLeadsModalProps> = ({
  isOpen,
  onClose,
  leads,
  handlers,
  onAssignComplete
}) => {
  const [selectedHandlers, setSelectedHandlers] = useState<number[]>([]);
  const [handlerSearchQuery, setHandlerSearchQuery] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignmentStrategy, setAssignmentStrategy] = useState<'all' | 'manual'>('all');
  const [manualAssignments, setManualAssignments] = useState<Map<string | number, number>>(new Map()); // leadId -> handlerId
  const [employees, setEmployees] = useState<Map<number, Employee>>(new Map());
  const [handlerSearchQueries, setHandlerSearchQueries] = useState<Map<string | number, string>>(new Map()); // leadId -> search query
  const [openDropdowns, setOpenDropdowns] = useState<Set<string | number>>(new Set()); // leadId -> is open

  // Fetch employees for avatars
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo');

      if (!error && data) {
        const employeeMap = new Map<number, Employee>();
        data.forEach(emp => {
          employeeMap.set(emp.id, emp);
        });
        setEmployees(employeeMap);
      }
    };
    if (isOpen) {
      fetchEmployees();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedHandlers([]);
      setHandlerSearchQuery('');
      setAssignmentStrategy('all');
      setManualAssignments(new Map());
      setHandlerSearchQueries(new Map());
      setOpenDropdowns(new Set());
    }
  }, [isOpen]);

  // Helper function to get employee by ID
  const getEmployeeById = (employeeId: number | string | null | undefined): Employee | null => {
    if (!employeeId) return null;
    const id = typeof employeeId === 'string' ? parseInt(employeeId) : employeeId;
    return employees.get(id) || null;
  };

  // Helper function to get employee initials
  const getEmployeeInitials = (name: string): string => {
    if (!name) return '--';
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Employee Avatar Component
  const EmployeeAvatar: React.FC<{
    employeeId: number | string | null | undefined;
    size?: 'xs' | 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = {
      xs: 'w-6 h-6 text-xs',
      sm: 'w-8 h-8 text-xs',
      md: 'w-12 h-12 text-sm',
      lg: 'w-16 h-16 text-base'
    };

    if (!employee) {
      return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center bg-gray-200 text-gray-500 font-semibold`}>
          --
        </div>
      );
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    if (imageError || !photoUrl) {
      return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold`}>
          {initials}
        </div>
      );
    }

    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses[size]} rounded-full object-cover`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  // Filter handlers based on search
  const filteredHandlers = handlers.filter(handler =>
    handler.display_name.toLowerCase().includes(handlerSearchQuery.toLowerCase()) ||
    handler.department?.toLowerCase().includes(handlerSearchQuery.toLowerCase())
  );

  const toggleHandlerSelection = (handlerId: number) => {
    setSelectedHandlers(prev => {
      if (prev.includes(handlerId)) {
        return prev.filter(id => id !== handlerId);
      } else {
        return [...prev, handlerId];
      }
    });
  };

  const handleAssign = async () => {
    if (assignmentStrategy === 'manual') {
      // For manual assignment, check if all leads have been assigned
      const unassignedLeads = leads.filter(lead => !manualAssignments.has(lead.id));
      if (unassignedLeads.length > 0) {
        toast.error(`Please assign all ${leads.length} leads. ${unassignedLeads.length} lead(s) still unassigned.`);
        return;
      }
    } else {
      // For 'all' strategy, need at least one handler
      if (selectedHandlers.length === 0) {
        toast.error('Please select at least one handler');
        return;
      }
    }

    if (leads.length === 0) {
      toast.error('No leads to assign');
      return;
    }

    setAssigning(true);
    try {
      const results: { success: boolean }[] = [];

      if (assignmentStrategy === 'all') {
        // Assign all leads to all selected handlers
        for (const lead of leads) {
          for (const handlerId of selectedHandlers) {
            const handler = handlers.find(h => h.id === handlerId);
            if (!handler) {
              results.push({ success: false });
              continue;
            }

            try {
              await assignLead(lead, handlerId, handler.display_name);
              results.push({ success: true });
            } catch (error) {
              console.error('Error assigning lead:', error);
              results.push({ success: false });
            }
          }
        }
      } else {
        // Manual assignment - assign each lead to its selected handler
        for (const lead of leads) {
          const handlerId = manualAssignments.get(lead.id);
          if (!handlerId) {
            results.push({ success: false });
            continue;
          }

          const handler = handlers.find(h => h.id === handlerId);
          if (!handler) {
            results.push({ success: false });
            continue;
          }

          try {
            await assignLead(lead, handlerId, handler.display_name);
            results.push({ success: true });
          } catch (error) {
            console.error('Error assigning lead:', error);
            results.push({ success: false });
          }
        }
      }

      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;

      if (errorCount === 0) {
        toast.success(`Successfully assigned ${successCount} lead(s)`);
      } else {
        toast.success(`Assigned ${successCount} lead(s), ${errorCount} failed`);
      }

      onAssignComplete();
      onClose();
    } catch (error: any) {
      console.error('Error assigning leads:', error);
      toast.error('Failed to assign leads');
    } finally {
      setAssigning(false);
    }
  };

  const assignLead = async (lead: UnassignedLead, handlerId: number, handlerName: string) => {
    const isLegacy = lead.isLegacy || (typeof lead.id === 'string' && lead.id.startsWith('legacy_'));

    if (isLegacy) {
      const legacyId = typeof lead.id === 'string' && lead.id.startsWith('legacy_')
        ? parseInt(lead.id.replace('legacy_', ''))
        : typeof lead.id === 'number' ? lead.id : parseInt(String(lead.id));

      if (isNaN(legacyId)) {
        throw new Error('Invalid legacy lead ID');
      }

      const { error } = await supabase
        .from('leads_lead')
        .update({ case_handler_id: handlerId })
        .eq('id', legacyId);

      if (error) throw error;
    } else {
      // For new leads, update both handler (text) and case_handler_id (numeric)
      const leadId = typeof lead.id === 'string' ? lead.id : String(lead.id);

      const { error } = await supabase
        .from('leads')
        .update({
          handler: handlerName,
          case_handler_id: handlerId
        })
        .eq('id', leadId);

      if (error) throw error;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[98vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Assign Multiple Leads</h3>
            <p className="text-sm text-gray-600 mt-1">
              {leads.length} lead{leads.length !== 1 ? 's' : ''} will be assigned
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-sm btn-circle btn-ghost"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Assignment Strategy */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Assignment Strategy
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="assignmentStrategy"
                  value="all"
                  checked={assignmentStrategy === 'all'}
                  onChange={(e) => setAssignmentStrategy(e.target.value as 'all' | 'manual')}
                  className="radio radio-primary"
                />
                <span className="text-sm">
                  Select All - Assign all leads to all selected handlers
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="assignmentStrategy"
                  value="manual"
                  checked={assignmentStrategy === 'manual'}
                  onChange={(e) => setAssignmentStrategy(e.target.value as 'all' | 'manual')}
                  className="radio radio-primary"
                />
                <span className="text-sm">
                  Manually Select - Choose handler for each lead
                </span>
              </label>
            </div>
          </div>

          {assignmentStrategy === 'all' ? (
            /* Handler Search for 'Select All' strategy */
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Handlers (Multi-select)
              </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
              placeholder="Search handlers..."
              value={handlerSearchQuery}
              onChange={(e) => setHandlerSearchQuery(e.target.value)}
            />
            <div className="border border-gray-300 rounded-md max-h-60 overflow-y-auto">
              {filteredHandlers.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No handlers found
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredHandlers.map(handler => {
                    const isSelected = selectedHandlers.includes(handler.id);
                    return (
                      <div
                        key={handler.id}
                        className="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3"
                        onClick={() => toggleHandlerSelection(handler.id)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleHandlerSelection(handler.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="checkbox checkbox-primary"
                        />
                        <EmployeeAvatar employeeId={handler.id} size="md" />
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{handler.display_name}</p>
                          {handler.department && (
                            <p className="text-sm text-gray-500">{handler.department}</p>
                          )}
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-xs text-gray-500">New Cases</p>
                            <p className="text-sm font-semibold text-gray-900">{handler.newCasesCount ?? 0}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-500">Active Cases</p>
                            <p className="text-sm font-semibold" style={{ color: 'rgb(25, 49, 31)' }}>
                              {handler.activeCasesCount ?? 0}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {selectedHandlers.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setSelectedHandlers([])}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Clear selection ({selectedHandlers.length} selected)
                </button>
              </div>
            )}
          </div>
          ) : (
            /* Manual Selection UI */
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assign Each Lead to a Handler
              </label>
              <div className="border border-gray-300 rounded-md max-h-[60vh] overflow-y-auto">
                {leads.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No leads to assign
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {leads.map(lead => {
                      const assignedHandlerId = manualAssignments.get(lead.id);
                      const assignedHandler = assignedHandlerId 
                        ? handlers.find(h => h.id === assignedHandlerId)
                        : null;
                      const searchQuery = handlerSearchQueries.get(lead.id) || '';
                      const isDropdownOpen = openDropdowns.has(lead.id);
                      
                      // Filter handlers based on search query
                      const filteredHandlersForLead = handlers.filter(handler =>
                        handler.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        handler.department?.toLowerCase().includes(searchQuery.toLowerCase())
                      );

                      return (
                        <div key={lead.id} className="p-3 hover:bg-gray-50 relative">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {lead.lead_number || lead.id} - {lead.name}
                              </p>
                            </div>
                            <div className="flex-shrink-0 relative w-64">
                              <input
                                type="text"
                                className="input input-bordered input-sm w-full"
                                placeholder="Search and select handler..."
                                value={assignedHandler ? `${assignedHandler.display_name}${assignedHandler.department ? ` (${assignedHandler.department})` : ''}` : searchQuery}
                                onChange={(e) => {
                                  const query = e.target.value;
                                  setHandlerSearchQueries(prev => {
                                    const newMap = new Map(prev);
                                    newMap.set(lead.id, query);
                                    return newMap;
                                  });
                                  if (!isDropdownOpen) {
                                    setOpenDropdowns(prev => new Set(prev).add(lead.id));
                                  }
                                  // Clear assignment if user starts typing
                                  if (assignedHandlerId) {
                                    setManualAssignments(prev => {
                                      const newMap = new Map(prev);
                                      newMap.delete(lead.id);
                                      return newMap;
                                    });
                                  }
                                }}
                                onFocus={() => {
                                  setOpenDropdowns(prev => new Set(prev).add(lead.id));
                                }}
                                onBlur={() => {
                                  // Delay closing to allow click on dropdown item
                                  setTimeout(() => {
                                    setOpenDropdowns(prev => {
                                      const newSet = new Set(prev);
                                      newSet.delete(lead.id);
                                      return newSet;
                                    });
                                  }, 200);
                                }}
                              />
                              {isDropdownOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-[49]"
                                    onClick={() => {
                                      setOpenDropdowns(prev => {
                                        const newSet = new Set(prev);
                                        newSet.delete(lead.id);
                                        return newSet;
                                      });
                                    }}
                                  />
                                  <div className="absolute z-[51] w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                    {filteredHandlersForLead.length === 0 ? (
                                      <div className="p-4 text-center text-gray-500 text-sm">
                                        No handlers found
                                      </div>
                                    ) : (
                                      <div className="divide-y divide-gray-200">
                                        {filteredHandlersForLead.map(handler => (
                                          <div
                                            key={handler.id}
                                            className="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3"
                                            onClick={() => {
                                              setManualAssignments(prev => {
                                                const newMap = new Map(prev);
                                                newMap.set(lead.id, handler.id);
                                                return newMap;
                                              });
                                              setHandlerSearchQueries(prev => {
                                                const newMap = new Map(prev);
                                                newMap.delete(lead.id);
                                                return newMap;
                                              });
                                              setOpenDropdowns(prev => {
                                                const newSet = new Set(prev);
                                                newSet.delete(lead.id);
                                                return newSet;
                                              });
                                            }}
                                          >
                                            <EmployeeAvatar employeeId={handler.id} size="sm" />
                                            <div className="flex-1">
                                              <p className="font-medium text-gray-900">{handler.display_name}</p>
                                              {handler.department && (
                                                <p className="text-sm text-gray-500">{handler.department}</p>
                                              )}
                                            </div>
                                            <div className="flex-shrink-0 flex items-center gap-3">
                                              <div className="text-right">
                                                <p className="text-xs text-gray-500">New</p>
                                                <p className="text-sm font-semibold text-gray-900">{handler.newCasesCount ?? 0}</p>
                                              </div>
                                              <div className="text-right">
                                                <p className="text-xs text-gray-500">Active</p>
                                                <p className="text-sm font-semibold" style={{ color: 'rgb(25, 49, 31)' }}>
                                                  {handler.activeCasesCount ?? 0}
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                            {assignedHandler && (
                              <div className="flex-shrink-0">
                                <EmployeeAvatar employeeId={assignedHandler.id} size="sm" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="mt-2 text-sm text-gray-600">
                {manualAssignments.size} of {leads.length} leads assigned
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
          <button
            className="btn btn-outline"
            onClick={onClose}
            disabled={assigning}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleAssign}
            disabled={
              assigning || 
              (assignmentStrategy === 'all' && selectedHandlers.length === 0) ||
              (assignmentStrategy === 'manual' && manualAssignments.size !== leads.length)
            }
          >
            {assigning ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Assigning...
              </>
            ) : (
              `Assign ${leads.length} Lead${leads.length !== 1 ? 's' : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssignMultipleLeadsModal;
