import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import TimelineHistoryButtons from './TimelineHistoryButtons';
import { UserGroupIcon, PencilSquareIcon, UserIcon, CheckIcon, XMarkIcon, CalendarIcon, UserCircleIcon, AcademicCapIcon, HandRaisedIcon, WrenchScrewdriverIcon, CogIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

interface Role {
  id: string;
  title: string;
  assignee: string;
  fieldName: string;
  legacyFieldName?: string; // For legacy leads
}

// Will be replaced by real users from DB
const defaultAssignees = ['---'];

const RolesTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [allUsers, setAllUsers] = useState<{ full_name: string; role: string }[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [expertOptions, setExpertOptions] = useState<string[]>(defaultAssignees);
  const [schedulerOptions, setSchedulerOptions] = useState<string[]>(defaultAssignees);
  const [handlerOptions, setHandlerOptions] = useState<string[]>(defaultAssignees);
  const [closerOptions, setCloserOptions] = useState<string[]>(defaultAssignees);
  const [allUserOptions, setAllUserOptions] = useState<string[]>(defaultAssignees);
  
  // Check if this is a legacy lead
  const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
  
  const [roles, setRoles] = useState<Role[]>([
    { id: 'scheduler', title: 'Scheduler', assignee: '---', fieldName: 'scheduler', legacyFieldName: 'meeting_scheduler_id' },
    { id: 'manager', title: 'Manager', assignee: '---', fieldName: 'manager', legacyFieldName: 'meeting_manager_id' },
    { id: 'helper', title: 'Helper', assignee: '---', fieldName: 'helper', legacyFieldName: 'meeting_lawyer_id' },
    { id: 'expert', title: 'Expert', assignee: '---', fieldName: 'expert', legacyFieldName: 'expert_id' },
    { id: 'closer', title: 'Closer', assignee: '---', fieldName: 'closer', legacyFieldName: 'closer_id' },
    { id: 'handler', title: 'Handler', assignee: '---', fieldName: 'handler', legacyFieldName: 'case_handler_id' },
  ]);

  const [isEditing, setIsEditing] = useState(false);
  const [originalRoles, setOriginalRoles] = useState<Role[]>([]);

  // Update roles when client data changes
  useEffect(() => {
    const getEmployeeDisplayName = (employeeId: string | null | undefined) => {
      if (!employeeId || employeeId === '---') return '---';
      // For legacy leads, the IDs should match tenants_employee table
      const employee = allEmployees.find((emp: any) => emp.id.toString() === employeeId.toString());
      return employee ? employee.display_name : employeeId; // Fallback to ID if not found
    };

    const updatedRoles = [
      { 
        id: 'scheduler', 
        title: 'Scheduler', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).meeting_scheduler_id) : client.scheduler || '---', 
        fieldName: 'scheduler', 
        legacyFieldName: 'meeting_scheduler_id' 
      },
      { 
        id: 'manager', 
        title: 'Manager', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).meeting_manager_id) : client.manager || '---', 
        fieldName: 'manager', 
        legacyFieldName: 'meeting_manager_id' 
      },
      { 
        id: 'helper', 
        title: 'Helper', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).meeting_lawyer_id) : client.helper || '---', 
        fieldName: 'helper', 
        legacyFieldName: 'meeting_lawyer_id' 
      },
      { 
        id: 'expert', 
        title: 'Expert', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).expert_id) : client.expert || '---', 
        fieldName: 'expert', 
        legacyFieldName: 'expert_id' 
      },
      { 
        id: 'closer', 
        title: 'Closer', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).closer_id) : getEmployeeDisplayName(client.closer), 
        fieldName: 'closer', 
        legacyFieldName: 'closer_id' 
      },
      { 
        id: 'handler', 
        title: 'Handler', 
        assignee: isLegacyLead ? getEmployeeDisplayName((client as any).case_handler_id) : client.handler || '---', 
        fieldName: 'handler', 
        legacyFieldName: 'case_handler_id' 
      },
    ];
    setRoles(updatedRoles);
    setOriginalRoles(updatedRoles);
  }, [client, isLegacyLead, allEmployees]);

  // Fetch all employees from tenants_employee table for dropdowns
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, bonuses_role')
        .order('display_name', { ascending: true });
      
      if (!error && data) {
        setAllEmployees(data);
        
        // Filter employees by bonuses_role for specific dropdowns
        const schedulerEmployees = data.map((emp: any) => emp.display_name); // Changed to fetch all employees for scheduler
        const expertEmployees = data.filter((emp: any) => emp.bonuses_role === 'e').map((emp: any) => emp.display_name);
        const handlerEmployees = data.filter((emp: any) => emp.bonuses_role === 'h').map((emp: any) => emp.display_name);
        const closerEmployees = data.map((emp: any) => emp.display_name); // Changed to fetch all employees
        const allEmployees = data.map((emp: any) => emp.display_name);

        setSchedulerOptions(['---', ...schedulerEmployees]);
        setExpertOptions(['---', ...expertEmployees]);
        setHandlerOptions(['---', ...handlerEmployees]);
        setCloserOptions(['---', ...closerEmployees]);
        setAllUserOptions(['---', ...allEmployees]);
      }
    };
    fetchEmployees();
  }, []);

  const handleRoleChange = (roleId: string, newAssignee: string) => {
    setRoles(roles.map(role => 
      role.id === roleId ? { ...role, assignee: newAssignee } : role
    ));
  };

  const handleSaveRoles = async () => {
    try {
      // Prepare update object with all role changes
      const updateData: any = {};
      roles.forEach(role => {
        if (isLegacyLead && role.legacyFieldName) {
          // For legacy leads, use the legacy field names
          updateData[role.legacyFieldName] = role.assignee === '---' ? null : role.assignee;
        } else {
          // For new leads, use the standard field names
          updateData[role.fieldName] = role.assignee === '---' ? null : role.assignee;
        }
      });

      let error;
      if (isLegacyLead) {
        // Update legacy lead in leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error: legacyError } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);
        error = legacyError;
      } else {
        // Update new lead in leads table
        const { error: newError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', client.id);
        error = newError;
      }

      if (error) throw error;

      setOriginalRoles([...roles]);
      setIsEditing(false);
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error saving roles:', error);
      alert('Failed to save roles');
    }
  };

  const handleCancelEdit = () => {
    setRoles([...originalRoles]);
    setIsEditing(false);
  };

  const handleSetMeAsCloser = async () => {
    try {
      const updateData = { closer: 'Current User' }; // You can replace this with actual user name
      let error;
      
      if (isLegacyLead) {
        // Update legacy lead in leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');
        const { error: legacyError } = await supabase
          .from('leads_lead')
          .update({ closer_id: 'Current User' })
          .eq('id', legacyId);
        error = legacyError;
      } else {
        // Update new lead in leads table
        const { error: newError } = await supabase
          .from('leads')
          .update(updateData)
          .eq('id', client.id);
        error = newError;
      }

      if (error) throw error;

      // Update local state
      const updatedRoles = roles.map(role => 
        role.id === 'closer' ? { ...role, assignee: 'Current User' } : role
      );
      setRoles(updatedRoles);
      setOriginalRoles(updatedRoles);
      
      // Refresh client data in parent component
      if (onClientUpdate) {
        await onClientUpdate();
      }
    } catch (error) {
      console.error('Error setting closer:', error);
      alert('Failed to set closer');
    }
  };

  // Function to get the appropriate icon for each role
  const getRoleIcon = (roleId: string) => {
    switch (roleId) {
      case 'scheduler':
        return CalendarIcon;
      case 'manager':
        return UserCircleIcon;
      case 'helper':
        return WrenchScrewdriverIcon;
      case 'expert':
        return AcademicCapIcon;
      case 'closer':
        return HandRaisedIcon;
      case 'handler':
        return CogIcon;
      default:
        return UserIcon;
    }
  };

  return (
    <div className="p-2 sm:p-4 md:p-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-8 h-8 bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
          <UserGroupIcon className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">Roles</h2>
          <p className="text-sm text-gray-500">
            Manage team roles and assignments
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {roles.map((role, idx) => {
          const hasAssignee = role.assignee && role.assignee !== '---';
          const initials = hasAssignee
            ? role.assignee.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
            : '';
          
          return (
            <div
              key={role.id}
              className="bg-white border border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 overflow-hidden"
            >
              {/* Title Section */}
              <div className="pl-6 pt-2 pb-2 w-2/5">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-black">{role.title}</h4>
                </div>
                <div className="border-b border-gray-200 mt-2"></div>
              </div>
              
              {/* Content Section */}
              <div className="p-6">
                <div className="flex items-center gap-4">
                  {/* Role Icon */}
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600">
                    {React.createElement(getRoleIcon(role.id), { className: "w-6 h-6 text-white" })}
                  </div>
                  
                  {/* Assignee Name */}
                  <div className="flex-1">
                    {isEditing ? (
                      <select
                        className="select select-bordered w-full max-w-xs font-semibold text-base"
                        value={role.assignee}
                        onChange={(e) => handleRoleChange(role.id, e.target.value)}
                      >
                        {(role.id === 'expert'
                          ? expertOptions
                          : role.id === 'scheduler'
                            ? schedulerOptions
                            : role.id === 'handler'
                              ? handlerOptions
                              : role.id === 'closer'
                                ? closerOptions
                                : allUserOptions
                        ).map((assignee: string) => (
                          <option key={assignee} value={assignee}>
                            {assignee}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`text-base font-semibold ${hasAssignee ? 'text-gray-900' : 'text-gray-500 italic'}`}> 
                        {hasAssignee ? role.assignee : 'Unassigned'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Action Bar - centered */}
      <div className="flex flex-row gap-4 px-6 py-4 rounded-xl bg-white shadow border border-base-200/60 w-fit mx-auto z-20 animate-fadeInUp">
          {isEditing ? (
            <>
              <button 
                className="btn btn-primary gap-2 px-6 shadow-md hover:scale-105 transition-transform"
                onClick={handleSaveRoles}
              >
                <CheckIcon className="w-5 h-5" />
                Save Roles
              </button>
              <button 
                className="btn btn-ghost gap-2 px-6 border border-base-200 shadow-sm hover:bg-base-200/60 hover:scale-105 transition-transform"
                onClick={handleCancelEdit}
              >
                <XMarkIcon className="w-5 h-5" />
                Cancel
              </button>
            </>
          ) : (
            <button 
              className="btn btn-neutral gap-2 px-6 shadow-md hover:scale-105 transition-transform"
              onClick={() => setIsEditing(true)}
            >
              <PencilSquareIcon className="w-5 h-5" />
              Set Roles
            </button>
          )}
          <button 
            className="btn btn-ghost text-primary hover:bg-primary/10 gap-2 px-6 border border-primary/30 shadow-sm hover:scale-105 transition-transform"
            onClick={handleSetMeAsCloser}
          >
            <UserIcon className="w-5 h-5" />
            Set me as closer
          </button>
      </div>
      
      <TimelineHistoryButtons client={client} />
    </div>
  );
};

export default RolesTab; 