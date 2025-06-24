import React, { useState, useEffect } from 'react';
import { ClientTabProps } from '../../types/client';
import { UserGroupIcon, PencilSquareIcon, UserIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';

interface Role {
  id: string;
  title: string;
  assignee: string;
  fieldName: string;
}

const fakeAssignees = [
  '---',
  'David',
  'Sarah',
  'Michael',
  'Rachel',
  'Daniel',
  'Leah',
  'Jonathan',
  'Miriam',
  'Jacob',
  'Esther'
];

const RolesTab: React.FC<ClientTabProps> = ({ client, onClientUpdate }) => {
  const [roles, setRoles] = useState<Role[]>([
    { id: 'scheduler', title: 'Scheduler', assignee: '---', fieldName: 'scheduler' },
    { id: 'manager', title: 'Manager', assignee: '---', fieldName: 'manager' },
    { id: 'helper', title: 'Helper', assignee: '---', fieldName: 'helper' },
    { id: 'expert', title: 'Expert', assignee: '---', fieldName: 'expert' },
    { id: 'closer', title: 'Closer', assignee: '---', fieldName: 'closer' },
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
    ];
    setRoles(updatedRoles);
    setOriginalRoles(updatedRoles);
  }, [client]);

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

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <UserGroupIcon className="w-6 h-6 text-primary" />
        <h3 className="text-2xl font-semibold">Roles</h3>
      </div>

      <div className="card bg-base-100 shadow-lg">
        <div className="card-body">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-8">
            {roles.map((role) => (
              <div 
                key={role.id}
                className="flex flex-col items-center text-center space-y-3 p-4 rounded-lg bg-base-200/50"
              >
                <span className="text-base text-base-content/70 font-medium">
                  {role.title}
                </span>
                {isEditing ? (
                  <select
                    className="select select-bordered w-full"
                    value={role.assignee}
                    onChange={(e) => handleRoleChange(role.id, e.target.value)}
                  >
                    {fakeAssignees.map((assignee) => (
                      <option key={assignee} value={assignee}>
                        {assignee}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-xl font-semibold ${role.assignee === '---' ? 'text-base-content/30' : ''}`}>
                    {role.assignee}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="card-actions justify-start gap-3 mt-8">
            {isEditing ? (
              <>
                <button 
                  className="btn btn-primary gap-2"
                  onClick={handleSaveRoles}
                >
                  <CheckIcon className="w-5 h-5" />
                  Save Roles
                </button>
                <button 
                  className="btn btn-ghost gap-2"
                  onClick={handleCancelEdit}
                >
                  <XMarkIcon className="w-5 h-5" />
                  Cancel
                </button>
              </>
            ) : (
              <button 
                className="btn btn-neutral gap-2"
                onClick={() => setIsEditing(true)}
              >
                <PencilSquareIcon className="w-5 h-5" />
                Set Roles
              </button>
            )}
            <button 
              className="btn btn-ghost text-primary hover:bg-primary/10 gap-2"
              onClick={handleSetMeAsCloser}
            >
              <UserIcon className="w-5 h-5" />
              Set me as closer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RolesTab; 