import React, { useState, useEffect } from 'react';
import { PlusIcon, PencilIcon, TrashIcon, UserIcon, XMarkIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

// Backend API configuration
const API_BASE_URL = 'https://leadify-crm-backend.onrender.com/api';

interface User {
  id: string;
  email: string;
  name: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: 'user' | 'admin' | 'handler' | 'closer' | 'scheduler' | 'expert';
  created_at: string;
  updated_at: string;
  is_active?: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  last_login?: string;
  date_joined?: string;
  groups?: string[];
  user_permissions?: string[];
}

interface Group {
  id: number;
  name: string;
  description: string;
}

interface Permission {
  id: number;
  name: string;
  codename: string;
  description: string;
}

interface UserChange {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by_name: string;
  changed_by_email: string | null;
}

interface UserFormData {
  email: string;
  password: string;
  full_name: string;
  first_name: string;
  last_name: string;
  role: 'user' | 'admin' | 'handler' | 'closer' | 'scheduler' | 'expert';
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  groups: string[];
  user_permissions: string[];
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [userChanges, setUserChanges] = useState<UserChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    newPassword: '',
    confirmPassword: ''
  });
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    password: '',
    full_name: '',
    first_name: '',
    last_name: '',
    role: 'user',
    is_active: true,
    is_staff: false,
    is_superuser: false,
    groups: [],
    user_permissions: []
  });

  useEffect(() => {
    loadUsers();
    loadGroups();
    loadPermissions();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/users`);
      const result = await response.json();

      if (result.success) {
        setUsers(result.users || []);
      } else {
        throw new Error(result.error || 'Failed to load users');
      }
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('name');

      if (error) throw error;
      setGroups(data || []);
    } catch (error) {
      console.error('Error loading groups:', error);
    }
  };

  const loadPermissions = async () => {
    try {
      const { data, error } = await supabase
        .from('permissions')
        .select('*')
        .order('name');

      if (error) throw error;
      setPermissions(data || []);
    } catch (error) {
      console.error('Error loading permissions:', error);
    }
  };

  const loadUserChanges = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_changes_with_user_info')
        .select('*')
        .eq('user_id', userId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setUserChanges(data || []);
    } catch (error) {
      console.error('Error loading user changes:', error);
    }
  };

  const handleRowClick = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      password: '',
      full_name: user.full_name || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      role: user.role,
      is_active: user.is_active ?? true,
      is_staff: user.is_staff ?? false,
      is_superuser: user.is_superuser ?? false,
      groups: user.groups || [],
      user_permissions: user.user_permissions || []
    });
    loadUserChanges(user.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email || !formData.full_name) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      if (editingUser && editingUser.id) {
        // Update existing user
        const response = await fetch(`${API_BASE_URL}/users/${editingUser.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            full_name: formData.full_name,
            first_name: formData.first_name,
            last_name: formData.last_name,
            role: formData.role,
            is_active: formData.is_active,
            is_staff: formData.is_staff,
            is_superuser: formData.is_superuser,
            groups: formData.groups,
            user_permissions: formData.user_permissions
          })
        });

        const result = await response.json();

        if (result.success) {
          toast.success('User updated successfully');
        } else {
          throw new Error(result.error || 'Failed to update user');
        }
      } else {
        // Create new user
        if (!formData.password) {
          toast.error('Password is required for new users');
          return;
        }

        const response = await fetch(`${API_BASE_URL}/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            full_name: formData.full_name,
            first_name: formData.first_name,
            last_name: formData.last_name,
            role: formData.role,
            is_active: formData.is_active,
            is_staff: formData.is_staff,
            is_superuser: formData.is_superuser,
            groups: formData.groups,
            user_permissions: formData.user_permissions
          })
        });

        const result = await response.json();

        if (result.success) {
          toast.success('User created successfully');
        } else {
          throw new Error(result.error || 'Failed to create user');
        }
      }

      setEditingUser(null);
      setFormData({ email: '', password: '', full_name: '', first_name: '', last_name: '', role: 'user', is_active: true, is_staff: false, is_superuser: false, groups: [], user_permissions: [] });
      loadUsers();
    } catch (error: any) {
      console.error('Error saving user:', error);
      toast.error(error.message || 'Failed to save user');
    }
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Are you sure you want to delete ${user.name || user.email}?`)) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (result.success) {
        toast.success('User deleted successfully');
        loadUsers();
      } else {
        throw new Error(result.error || 'Failed to delete user');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  // Sync functions
  const syncSingleUser = async (email: string) => {
    try {
      const { data, error } = await supabase.rpc('sync_or_update_auth_user', {
        user_email: email
      });

      if (error) throw error;
      
      if (data && data.success) {
        toast.success(data.message);
        loadUsers();
      } else {
        toast.error(data?.message || 'Failed to sync user');
      }
    } catch (error) {
      console.error('Error syncing user:', error);
      toast.error('Failed to sync user');
    }
  };

  const syncAllUsers = async () => {
    try {
      const { data, error } = await supabase.rpc('sync_all_auth_users');

      if (error) throw error;
      
      if (data && data.success) {
        toast.success(data.message);
        loadUsers();
      } else {
        toast.error(data?.message || 'Failed to sync users');
      }
    } catch (error) {
      console.error('Error syncing users:', error);
      toast.error('Failed to sync users');
    }
  };

  const closeEdit = () => {
    setEditingUser(null);
    setFormData({ email: '', password: '', full_name: '', first_name: '', last_name: '', role: 'user', is_active: true, is_staff: false, is_superuser: false, groups: [], user_permissions: [] });
    setUserChanges([]);
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
          <p className="text-base-content/60 mt-1">Manage system users and their permissions</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary gap-2"
            onClick={async () => {
              const { data: fixResult } = await supabase.rpc('fix_all_auth_id_columns');
              console.log('Bulk fix result:', fixResult);
              if (fixResult?.success) {
                toast.success(fixResult.message);
                loadUsers(); // Reload the users list
              } else {
                toast.error('Bulk fix failed: ' + fixResult?.message);
              }
            }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Fix All Auth IDs
          </button>
          <button
            className="btn btn-accent gap-2"
            onClick={syncAllUsers}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync All Users
          </button>
          <button
            className="btn btn-primary gap-2"
            onClick={() => {
              setEditingUser({} as User);
              setFormData({
                email: '',
                password: '',
                full_name: '',
                first_name: '',
                last_name: '',
                role: 'user',
                is_active: true,
                is_staff: false,
                is_superuser: false,
                groups: [],
                user_permissions: []
              });
              setUserChanges([]);
            }}
          >
            <PlusIcon className="w-5 h-5" />
            Add User
          </button>
        </div>
      </div>

      <div className="mb-4">
                  <input
            type="text"
            placeholder="Search users by email or full name..."
            className="input input-bordered w-full max-w-md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
      </div>

      {!editingUser ? (
        <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Full Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Staff Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr 
                      key={user.id} 
                      className="hover cursor-pointer"
                      onClick={() => handleRowClick(user)}
                    >
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="avatar placeholder">
                            <div className="bg-neutral-focus text-neutral-content rounded-full w-10">
                              <UserIcon className="w-6 h-6" />
                            </div>
                          </div>
                          <div>
                            <div className="font-bold">{user.full_name || 'No name'}</div>
                            <div className="text-sm opacity-50">ID: {user.id.slice(0, 8)}...</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-sm">
                          {user.first_name && user.last_name 
                            ? `${user.first_name} ${user.last_name}`
                            : user.first_name || user.last_name || 'No name'
                          }
                        </span>
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
                        <div className="flex items-center justify-center">
                          {user.is_staff ? (
                            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            className="btn btn-ghost btn-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRowClick(user);
                            }}
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button
                            className="btn btn-ghost btn-xs text-error"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(user);
                            }}
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
      ) : (
        <div className="bg-white rounded-xl shadow-xl border border-gray-100">
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-6 rounded-t-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold">
                  {editingUser.id ? 'Edit User' : 'Add New User'}
                </h3>
                <p className="text-purple-100 mt-1">
                  {editingUser.id ? 'Update user information and permissions' : 'Create a new user account'}
                </p>
              </div>
              <button
                className="btn btn-ghost btn-circle text-white hover:bg-white/20 transition-colors"
                onClick={closeEdit}
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
          
          <form onSubmit={handleSubmit} className="p-8">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              {/* Basic Information */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <UserIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <h4 className="text-lg font-semibold text-gray-800">Basic Information</h4>
                </div>
                
                <div className="space-y-5">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Email Address *</span>
                    </label>
                    <input
                      type="email"
                      className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      disabled={!!editingUser.id}
                    />
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Username *</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                      value={formData.full_name}
                      onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium text-gray-700">First Name</span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      />
                    </div>

                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium text-gray-700">Last Name</span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      />
                    </div>
                  </div>

                  {editingUser && editingUser.id ? (
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium text-gray-700">Password</span>
                      </label>
                                        <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => setShowPasswordModal(true)}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      Change Password
                    </button>



                    <button
                      type="button"
                      className="btn btn-outline border-red-300 text-red-700 hover:bg-red-50"
                      onClick={async () => {
                        const password = prompt('Enter password for recreation:');
                        if (password) {
                          const { data: recreateResult } = await supabase.rpc('recreate_auth_user_properly', {
                            user_email: editingUser?.email || '',
                            user_password: password,
                            user_full_name: editingUser?.full_name || ''
                          });
                          console.log('Recreate result:', recreateResult);
                          if (recreateResult?.success) {
                            toast.success('User recreated successfully!');
                            loadUsers(); // Reload the users list
                          } else {
                            toast.error('Recreation failed: ' + recreateResult?.message);
                          }
                        }
                      }}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Recreate User
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline border-green-300 text-green-700 hover:bg-green-50"
                      onClick={async () => {
                        const newEmail = prompt('Enter new email (with real domain like gmail.com):');
                        const password = prompt('Enter password:');
                        if (newEmail && password) {
                          try {
                            // Use Supabase signup API (simpler than admin)
                            const { data, error } = await supabase.auth.signUp({
                              email: newEmail,
                              password: password,
                              options: {
                                data: {
                                  full_name: editingUser?.full_name || 'Test User'
                                }
                              }
                            });
                            
                            if (error) {
                              console.error('Signup error:', error);
                              toast.error('Creation failed: ' + error.message);
                            } else {
                              console.log('Signup result:', data);
                              toast.success('User created successfully! Check email for confirmation.');
                              loadUsers(); // Reload the users list
                            }
                          } catch (err) {
                            console.error('Error creating user:', err);
                            toast.error('Creation failed: ' + err);
                          }
                        }
                      }}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Create User (Signup)
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                      onClick={async () => {
                        const { data: checkResult } = await supabase.rpc('check_and_fix_user_auth', {
                          user_email: editingUser?.email || ''
                        });
                        console.log('Check and fix result:', checkResult);
                        if (checkResult?.success) {
                          toast.success('User auth status checked and fixed!');
                        } else {
                          toast.error('Check failed: ' + checkResult?.message);
                        }
                      }}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Check & Fix Auth
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => syncSingleUser(editingUser?.email || '')}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Sync to Custom Table
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                      onClick={async () => {
                        const { data: syncResult } = await supabase.rpc('sync_auth_user_to_custom_table', {
                          user_email: editingUser?.email || ''
                        });
                        console.log('Sync result:', syncResult);
                        if (syncResult?.success) {
                          toast.success('User synced to custom table!');
                          loadUsers(); // Reload the users list
                        } else {
                          toast.error('Sync failed: ' + syncResult?.message);
                        }
                      }}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Sync to Custom Table
                    </button>
                  </div>
                    </div>
                  ) : (
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium text-gray-700">Password *</span>
                      </label>
                      <input
                        type="password"
                        className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                        minLength={6}
                        placeholder="Enter password for new user"
                      />
                    </div>
                  )}

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Role</span>
                    </label>
                    <select
                      className="select select-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    >
                      <option value="user">User</option>
                      <option value="handler">Handler</option>
                      <option value="closer">Closer</option>
                      <option value="scheduler">Scheduler</option>
                      <option value="expert">Expert</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Permissions */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-gray-800">Permissions & Access</h4>
                </div>
                
                <div className="space-y-5">
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      />
                      <div className="flex-1">
                        <span className="label-text font-semibold text-gray-800">Active</span>
                        <p className="text-sm text-gray-600 mt-1">User can log in to the system</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={formData.is_staff}
                        onChange={(e) => setFormData({ ...formData, is_staff: e.target.checked })}
                      />
                      <div className="flex-1">
                        <span className="label-text font-semibold text-gray-800">Staff Status</span>
                        <p className="text-sm text-gray-600 mt-1">User can access the admin panel</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-white rounded-lg p-4 border border-gray-200">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        className="toggle toggle-primary"
                        checked={formData.is_superuser}
                        onChange={(e) => setFormData({ ...formData, is_superuser: e.target.checked })}
                      />
                      <div className="flex-1">
                        <span className="label-text font-semibold text-gray-800">Superuser Status</span>
                        <p className="text-sm text-gray-600 mt-1">User has all permissions automatically</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mt-6">
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Groups (Admin Panel Access)</span>
                    </label>
                    <p className="text-sm text-gray-600 mb-3">Groups grant access to specific admin panel sections</p>
                    <select
                      className="select select-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !formData.groups.includes(e.target.value)) {
                          setFormData({ ...formData, groups: [...formData.groups, e.target.value] });
                        }
                        e.target.value = '';
                      }}
                    >
                      <option value="">Select a group to add...</option>
                      {groups.map(group => (
                        <option key={group.id} value={group.name}>
                          {group.name} - {group.description}
                        </option>
                      ))}
                    </select>
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-800"><strong>Template Access:</strong> Can manage contract templates (Misc tab)</p>
                      <p className="text-sm text-blue-800"><strong>Public Messages Access:</strong> Can manage public messages (Misc tab)</p>
                    </div>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">User Permissions</span>
                    </label>
                    <div className="mt-2">
                      <select
                        className="select select-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500 w-full"
                        value=""
                        onChange={(e) => {
                          if (e.target.value && !formData.user_permissions.includes(e.target.value)) {
                            setFormData({ ...formData, user_permissions: [...formData.user_permissions, e.target.value] });
                          }
                          e.target.value = '';
                        }}
                      >
                        <option value="">Select a permission to add...</option>
                        {permissions.map(permission => (
                          <option key={permission.id} value={permission.codename}>
                            {permission.name} - {permission.description}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected Items Panel */}
              <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-gray-800">Selected Items</h4>
                </div>
                
                <div className="space-y-5">
                  {/* Selected Groups */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Selected Groups</span>
                      <span className="label-text-alt badge badge-primary badge-sm">{formData.groups.length} selected</span>
                    </label>
                    <div className="bg-white rounded-lg border border-gray-200 p-3 min-h-[120px] max-h-[160px] overflow-y-auto">
                      {formData.groups.length === 0 ? (
                        <div className="text-center py-8">
                          <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m9-4a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          <p className="text-sm text-gray-500">No groups selected</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {formData.groups.map((groupName, index) => {
                            const group = groups.find(g => g.name === groupName);
                            return (
                              <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <div className="flex-1">
                                  <div className="font-semibold text-sm text-gray-800">{group?.name || groupName}</div>
                                  <div className="text-xs text-gray-600 mt-1">{group?.description || ''}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setFormData({
                                    ...formData,
                                    groups: formData.groups.filter((_, i) => i !== index)
                                  })}
                                  className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected Permissions */}
                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-medium text-gray-700">Selected Permissions</span>
                      <span className="label-text-alt badge badge-secondary badge-sm">{formData.user_permissions.length} selected</span>
                    </label>
                    <div className="bg-white rounded-lg border border-gray-200 p-3 min-h-[120px] max-h-[160px] overflow-y-auto">
                      {formData.user_permissions.length === 0 ? (
                        <div className="text-center py-8">
                          <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          <p className="text-sm text-gray-500">No permissions selected</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {formData.user_permissions.map((permissionCode, index) => {
                            const permission = permissions.find(p => p.codename === permissionCode);
                            return (
                              <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200">
                                <div className="flex-1">
                                  <div className="font-semibold text-sm text-gray-800">{permission?.name || permissionCode}</div>
                                  <div className="text-xs text-gray-600 mt-1">{permission?.description || ''}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setFormData({
                                    ...formData,
                                    user_permissions: formData.user_permissions.filter((_, i) => i !== index)
                                  })}
                                  className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* History Section */}
            {editingUser.id && userChanges.length > 0 && (
              <div className="mt-8 bg-gray-50 rounded-xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-gray-800">Change History</h4>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="max-h-60 overflow-y-auto">
                    <table className="table table-zebra w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="font-semibold text-gray-700">Field</th>
                          <th className="font-semibold text-gray-700">Old Value</th>
                          <th className="font-semibold text-gray-700">New Value</th>
                          <th className="font-semibold text-gray-700">Changed By</th>
                          <th className="font-semibold text-gray-700">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userChanges.map((change) => (
                          <tr key={change.id} className="hover:bg-gray-50">
                            <td className="font-medium text-gray-800">{change.field_name}</td>
                            <td className="text-sm text-gray-600">{change.old_value || 'None'}</td>
                            <td className="text-sm text-gray-600">{change.new_value || 'None'}</td>
                            <td className="text-sm text-gray-600">{change.changed_by_name}</td>
                            <td className="text-sm text-gray-600">{formatDate(change.changed_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-200">
              <button
                type="button"
                className="btn btn-outline border-gray-300 text-gray-700 hover:bg-gray-50"
                onClick={closeEdit}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0 hover:from-purple-700 hover:to-blue-700"
              >
                {editingUser.id ? 'Update User' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-800">Change Password</h3>
              <button
                className="btn btn-ghost btn-circle"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordData({ newPassword: '', confirmPassword: '' });
                }}
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              
              if (passwordData.newPassword !== passwordData.confirmPassword) {
                toast.error('Passwords do not match');
                return;
              }
              
              if (passwordData.newPassword.length < 6) {
                toast.error('Password must be at least 6 characters long');
                return;
              }
              
              try {
                // Update password using backend API
                const response = await fetch(`${API_BASE_URL}/users/${editingUser?.id}/password`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    newPassword: passwordData.newPassword
                  })
                });

                const result = await response.json();
                
                if (result.success) {
                  toast.success('Password updated successfully! User can log in.');
                } else {
                  throw new Error(result.error || 'Password update failed');
                }
                
                setShowPasswordModal(false);
                setPasswordData({ newPassword: '', confirmPassword: '' });
                
              } catch (error: any) {
                console.error('Error updating password:', error);
                toast.error('Failed to update password. Please ensure you have the necessary permissions.');
              }
            }}>
              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium text-gray-700">New Password *</span>
                  </label>
                  <input
                    type="password"
                    className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
                
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium text-gray-700">Confirm Password *</span>
                  </label>
                  <input
                    type="password"
                    className="input input-bordered bg-white border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  className="btn btn-outline border-gray-300 text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordData({ newPassword: '', confirmPassword: '' });
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0 hover:from-purple-700 hover:to-blue-700"
                >
                  Update Password
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