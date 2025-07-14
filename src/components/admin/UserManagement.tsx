import React, { useState, useEffect } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, UserIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface User {
  id: string;
  email: string;
  name: string | null;
  full_name: string | null;
  role: 'user' | 'admin' | 'handler' | 'closer' | 'scheduler' | 'expert';
  created_at: string;
  updated_at: string;
}

interface UserFormData {
  email: string;
  name: string;
  full_name: string;
  role: 'user' | 'admin' | 'handler' | 'closer' | 'scheduler' | 'expert';
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    name: '',
    full_name: '',
    role: 'user'
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.name) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      if (editingUser) {
        const { error } = await supabase
          .from('users')
          .update({
            email: formData.email,
            name: formData.name,
            full_name: formData.full_name,
            role: formData.role,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingUser.id);

        if (error) throw error;
        toast.success('User updated successfully');
      } else {
        const { error } = await supabase
          .from('users')
          .insert([{
            email: formData.email,
            name: formData.name,
            full_name: formData.full_name,
            role: formData.role
          }]);

        if (error) throw error;
        toast.success('User created successfully');
      }

      setShowModal(false);
      setEditingUser(null);
      setFormData({ email: '', name: '', full_name: '', role: 'user' });
      loadUsers();
    } catch (error: any) {
      console.error('Error saving user:', error);
      if (error.code === '23505') {
        toast.error('Email already exists');
      } else {
        toast.error('Failed to save user');
      }
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      name: user.name || '',
      full_name: user.full_name || '',
      role: user.role
    });
    setShowModal(true);
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to delete ${user.name || user.email}?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', user.id);

      if (error) throw error;
      toast.success('User deleted successfully');
      loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData({ email: '', name: '', full_name: '', role: 'user' });
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (user.name && user.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (user.full_name && user.full_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-base-content">User Management</h2>
          <p className="text-base-content/60 mt-1">Manage system users and their roles</p>
        </div>
        <button
          className="btn btn-primary gap-2"
          onClick={() => setShowModal(true)}
        >
          <PlusIcon className="w-5 h-5" />
          Add User
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users by email or name..."
          className="input input-bordered w-full max-w-md"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover">
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="avatar placeholder">
                          <div className="bg-neutral-focus text-neutral-content rounded-full w-10">
                            <UserIcon className="w-6 h-6" />
                          </div>
                        </div>
                        <div>
                          <div className="font-bold">{user.full_name || user.name || 'No name'}</div>
                          <div className="text-sm opacity-50">ID: {user.id.slice(0, 8)}...</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-sm">{user.email}</span>
                    </td>
                    <td>
                      <div className={`badge ${
                        user.role === 'admin' ? 'badge-error' :
                        user.role === 'expert' ? 'badge-warning' :
                        user.role === 'scheduler' ? 'badge-info' :
                        user.role === 'handler' ? 'badge-primary' :
                        user.role === 'closer' ? 'badge-secondary' :
                        'badge-success'
                      }`}>
                        {user.role}
                      </div>
                    </td>
                    <td>
                      <span className="text-sm">{formatDate(user.created_at)}</span>
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => handleEdit(user)}
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDelete(user)}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && !loading && (
              <div className="text-center py-12">
                <UserIcon className="w-16 h-16 mx-auto text-base-content/30 mb-4" />
                <p className="text-base-content/60">
                  {searchTerm ? 'No users found matching your search' : 'No users found'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">
              {editingUser ? 'Edit User' : 'Add New User'}
            </h3>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Email *</span>
                </label>
                <input
                  type="email"
                  className="input input-bordered"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  disabled={!!editingUser}
                />
                {editingUser && (
                  <label className="label">
                    <span className="label-text-alt">Email cannot be changed</span>
                  </label>
                )}
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Name *</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Full Name</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Role</span>
                </label>
                <select
                  className="select select-bordered"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'user' | 'admin' | 'handler' | 'closer' | 'scheduler' | 'expert' })}
                >
                  <option value="user">User</option>
                  <option value="handler">Handler</option>
                  <option value="closer">Closer</option>
                  <option value="scheduler">Scheduler</option>
                  <option value="expert">Expert</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;