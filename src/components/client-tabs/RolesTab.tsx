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

      <div className="relative animate-fadeInUp">
        {/* Roles Grid - 2 columns, smaller boxes, no colored line */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10 w-full max-w-3xl mx-auto">
          {roles.map((role, idx) => {
            const hasAssignee = role.assignee && role.assignee !== '---';
            const initials = hasAssignee
              ? role.assignee.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
              : '';
            // Assign a unique gradient per role
            const gradients = [
              'from-pink-500 via-purple-500 to-purple-600',
              'from-purple-600 via-blue-600 to-blue-500',
              'from-blue-500 via-cyan-500 to-teal-400',
              'from-teal-400 via-green-400 to-green-600',
              'from-yellow-400 via-orange-400 to-pink-500',
            ];
            const gradient = gradients[idx % gradients.length];
            return (
              <div
                key={role.id}
                className={`w-full max-w-sm mx-auto rounded-xl shadow-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[80px] relative bg-gradient-to-tr ${gradient} text-white overflow-hidden`}
              >
                {/* Role Title */}
                <div className="absolute top-2 left-3 text-lg font-extrabold uppercase tracking-wider text-white/80">
                  {role.title}
                </div>
                {/* Initials or Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold shadow mb-1 ${hasAssignee ? 'bg-white/20 text-white' : 'bg-white/10 text-white/60'}`}> 
                  {hasAssignee ? initials : <UserIcon className="w-6 h-6" />}
                </div>
                {/* Assignee Name */}
                {isEditing ? (
                  <select
                    className="select select-bordered w-full max-w-xs font-semibold text-base bg-white/20 text-white border-white/30 hover:bg-white/30 transition-colors duration-150 shadow-sm"
                    value={role.assignee}
                    onChange={(e) => handleRoleChange(role.id, e.target.value)}
                  >
                    {fakeAssignees.map((assignee) => (
                      <option key={assignee} value={assignee} className="text-black">
                        {assignee}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`text-base font-bold text-center ${hasAssignee ? 'text-white' : 'text-white/60 italic'}`}> 
                    {hasAssignee ? role.assignee : 'Unassigned'}
                  </span>
                )}
                {/* Optional: SVG icon/decoration in lower right */}
                <svg className="absolute bottom-2 right-2 w-8 h-4 opacity-30" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 32 16"><path d="M2 14 Q8 2 16 8 T30 2" /></svg>
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
      </div>
    </div>
  );
};

export default RolesTab; 