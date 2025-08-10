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
}

// Will be replaced by real users from DB
const defaultAssignees = ['---'];

const RolesTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [allUsers, setAllUsers] = useState<{ full_name: string; role: string }[]>([]);
  const [expertOptions, setExpertOptions] = useState<string[]>(defaultAssignees);
  const [schedulerOptions, setSchedulerOptions] = useState<string[]>(defaultAssignees);
  const [handlerOptions, setHandlerOptions] = useState<string[]>(defaultAssignees);
  const [allUserOptions, setAllUserOptions] = useState<string[]>(defaultAssignees);
  const [roles, setRoles] = useState<Role[]>([
    { id: 'scheduler', title: 'Scheduler', assignee: '---', fieldName: 'scheduler' },
    { id: 'manager', title: 'Manager', assignee: '---', fieldName: 'manager' },
    { id: 'helper', title: 'Helper', assignee: '---', fieldName: 'helper' },
    { id: 'expert', title: 'Expert', assignee: '---', fieldName: 'expert' },
    { id: 'closer', title: 'Closer', assignee: '---', fieldName: 'closer' },
    { id: 'handler', title: 'Handler', assignee: '---', fieldName: 'handler' },
  ]);

  const [isEditing, setIsEditing] = useState(false);
  const [originalRoles, setOriginalRoles] = useState<Role[]>([]);

  // Update roles when client data changes
  useEffect(() => {
    const updatedRoles = [
      { id: 'scheduler', title: 'Scheduler', assignee: client.scheduler || '---', fieldName: 'scheduler' },
      { id: 'manager', title: 'Manager', assignee: client.manager || '---', fieldName: 'manager' },
      { id: 'helper', title: 'Helper', assignee: client.helper || '---', fieldName: 'helper' },
      { id: 'expert', title: 'Expert', assignee: client.expert || '---', fieldName: 'expert' },
      { id: 'closer', title: 'Closer', assignee: client.closer || '---', fieldName: 'closer' },
      { id: 'handler', title: 'Handler', assignee: client.handler || '---', fieldName: 'handler' },
    ];
    setRoles(updatedRoles);
    setOriginalRoles(updatedRoles);
  }, [client]);

  // Fetch all users from DB for dropdowns
  useEffect(() => {
    const fetchUsers = async () => {
      const { data, error } = await supabase
        .from('users')
        .select('full_name, role')
        .order('full_name', { ascending: true });
      if (!error && data) {
        setAllUsers(data);
        setExpertOptions(['---', ...data.filter((u: any) => u.role === 'expert').map((u: any) => u.full_name)]);
        setSchedulerOptions(['---', ...data.filter((u: any) => u.role === 'scheduler').map((u: any) => u.full_name)]);
        setHandlerOptions(['---', ...data.filter((u: any) => u.role === 'handler').map((u: any) => u.full_name)]);
        setAllUserOptions(['---', ...data.map((u: any) => u.full_name)]);
      }
    };
    fetchUsers();
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
        updateData[role.fieldName] = role.assignee;
      });

      const { error } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', client.id);

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
      const { error } = await supabase
        .from('leads')
        .update({ closer: 'Current User' }) // You can replace this with actual user name
        .eq('id', client.id);

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
          <p className="text-sm text-gray-500">Manage team roles and assignments</p>
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
                              : allUserOptions
                        ).map((assignee) => (
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