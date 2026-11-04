const supabase = require('../config/supabase');
const bcrypt = require('bcryptjs');
require('dotenv').config();

class UserService {
  /**
   * Create a new user in both auth.users and custom users table
   */
  async createUser(userData) {
    try {
      const {
        email,
        password,
        employee_private_email,
        full_name,
        first_name,
        last_name,
        role = 'user',
        is_active = true,
        is_staff = false,
        is_superuser = false
      } = userData;

      // Validate required fields
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      const createEmail = String(email).trim().toLowerCase();

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', createEmail)
        .single();

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create user in Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: createEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: full_name || `${first_name || ''} ${last_name || ''}`.trim(),
          first_name,
          last_name
        }
      });

      if (authError) {
        console.error('Auth user creation error:', authError);
        throw new Error(`Failed to create auth user: ${authError.message}`);
      }

      const privateEmailRaw = String(employee_private_email || '').trim().toLowerCase();
      const privateEmail =
        privateEmailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privateEmailRaw)
          ? privateEmailRaw
          : createEmail;

      // Create user in custom users table.
      // Default private email to login email (recruitment); admin can set a distinct private address.
      const { data: customUser, error: customError } = await supabase
        .from('users')
        .insert({
          auth_id: authUser.user.id,
          email: createEmail,
          employee_private_email: privateEmail,
          full_name: full_name || `${first_name || ''} ${last_name || ''}`.trim(),
          first_name,
          last_name,
          role,
          is_active,
          is_staff,
          is_superuser,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (customError) {
        console.error('Custom user creation error:', customError);
        // Try to clean up auth user if custom user creation fails
        try {
          await supabase.auth.admin.deleteUser(authUser.user.id);
        } catch (cleanupError) {
          console.error('Failed to cleanup auth user:', cleanupError);
        }
        throw new Error(`Failed to create custom user: ${customError.message}`);
      }

      return {
        success: true,
        user: {
          id: customUser.id,
          auth_id: authUser.user.id,
          email: customUser.email,
          employee_private_email: customUser.employee_private_email,
          full_name: customUser.full_name,
          role: customUser.role,
          is_active: customUser.is_active,
          is_staff: customUser.is_staff,
          is_superuser: customUser.is_superuser
        }
      };

    } catch (error) {
      console.error('User creation error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get all users from custom users table
   */
  async getAllUsers() {
    try {
      const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch users: ${error.message}`);
      }

      return {
        success: true,
        users
      };

    } catch (error) {
      console.error('Get users error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update user password
   */
  async updateUserPassword(userId, newPassword) {
    try {
      // Get user email from custom table
      const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('email, auth_id')
        .eq('id', userId)
        .single();

      if (fetchError || !user) {
        throw new Error('User not found');
      }
      if (!user.auth_id) {
        throw new Error('This CRM user is not linked to a Supabase Auth user');
      }

      // Update password in auth.users
      const { error: authError } = await supabase.auth.admin.updateUserById(
        user.auth_id,
        { password: newPassword }
      );

      if (authError) {
        throw new Error(`Failed to update password: ${authError.message}`);
      }

      return {
        success: true,
        message: 'Password updated successfully'
      };

    } catch (error) {
      console.error('Password update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update user details
   */
  async updateUser(userId, updateData) {
    try {
      const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('id, auth_id, email, employee_private_email')
        .eq('id', userId)
        .single();

      if (fetchError || !existingUser) {
        throw new Error('User not found');
      }

      const nextEmail = String(updateData.email || '').trim().toLowerCase();
      if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
        throw new Error('A valid email address is required');
      }

      const previousEmail = String(existingUser.email || '').trim().toLowerCase();
      const emailChanged = nextEmail !== previousEmail;
      if (emailChanged && !existingUser.auth_id) {
        throw new Error('This CRM user is not linked to a Supabase Auth user');
      }

      if (emailChanged) {
        const { error: authError } = await supabase.auth.admin.updateUserById(
          existingUser.auth_id,
          { email: nextEmail, email_confirm: true }
        );
        if (authError) {
          throw new Error(`Failed to update auth email: ${authError.message}`);
        }
      }

      const safeUpdateData = {
        email: nextEmail,
        full_name: updateData.full_name,
        first_name: updateData.first_name,
        last_name: updateData.last_name,
        role: updateData.role,
        is_active: updateData.is_active,
        is_staff: updateData.is_staff,
        is_superuser: updateData.is_superuser,
        groups: updateData.groups,
        user_permissions: updateData.user_permissions,
        updated_at: new Date().toISOString()
      };

      // Keep / update private email. If login email changes and private was empty, preserve the old login email.
      const existingPrivate = String(existingUser.employee_private_email || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(updateData, 'employee_private_email')) {
        const nextPrivate = String(updateData.employee_private_email || '').trim().toLowerCase();
        if (nextPrivate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextPrivate)) {
          throw new Error('Employee private email must be a valid email address');
        }
        safeUpdateData.employee_private_email = nextPrivate || null;
      } else if (emailChanged && !existingPrivate && previousEmail) {
        safeUpdateData.employee_private_email = previousEmail;
      }

      // External-user assignment fields (Admin → Users)
      if (Object.prototype.hasOwnProperty.call(updateData, 'extern')) {
        safeUpdateData.extern = Boolean(updateData.extern);
      }
      if (Object.prototype.hasOwnProperty.call(updateData, 'extern_firm_id')) {
        const firmId = updateData.extern_firm_id;
        safeUpdateData.extern_firm_id =
          firmId == null || firmId === '' || firmId === '---' ? null : String(firmId);
      }
      if (Object.prototype.hasOwnProperty.call(updateData, 'extern_source_id')) {
        const raw = updateData.extern_source_id;
        if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
          safeUpdateData.extern_source_id = null;
        } else if (Array.isArray(raw)) {
          const ids = raw
            .map((id) => {
              if (id == null || id === '') return null;
              if (typeof id === 'number' && Number.isFinite(id)) {
                return Number.isSafeInteger(id) ? id : String(Math.trunc(id));
              }
              const s = String(id).trim();
              if (!s) return null;
              const n = Number(s);
              return Number.isSafeInteger(n) ? n : s;
            })
            .filter((id) => id != null);
          safeUpdateData.extern_source_id = ids.length > 0 ? ids : null;
        } else {
          safeUpdateData.extern_source_id = null;
        }
      }
      if (Object.prototype.hasOwnProperty.call(updateData, 'employee_id')) {
        const empId = updateData.employee_id;
        if (empId == null || empId === '' || empId === '---') {
          safeUpdateData.employee_id = null;
        } else {
          const n = Number(empId);
          safeUpdateData.employee_id = Number.isFinite(n) ? n : empId;
        }
      }

      const { data: user, error } = await supabase
        .from('users')
        .update(safeUpdateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        if (emailChanged) {
          const { error: rollbackError } = await supabase.auth.admin.updateUserById(
            existingUser.auth_id,
            { email: existingUser.email, email_confirm: true }
          );
          if (rollbackError) {
            console.error('Failed to roll back auth email:', rollbackError);
          }
        }
        throw new Error(`Failed to update user: ${error.message}`);
      }

      return {
        success: true,
        user
      };

    } catch (error) {
      console.error('User update error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    try {
      // Get user auth_id
      const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('auth_id')
        .eq('id', userId)
        .single();

      if (fetchError || !user) {
        throw new Error('User not found');
      }

      // Delete from custom users table
      const { error: customError } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (customError) {
        throw new Error(`Failed to delete custom user: ${customError.message}`);
      }

      // Delete from auth.users
      const { error: authError } = await supabase.auth.admin.deleteUser(user.auth_id);

      if (authError) {
        console.error('Failed to delete auth user:', authError);
        // Note: We don't throw here as the custom user is already deleted
      }

      return {
        success: true,
        message: 'User deleted successfully'
      };

    } catch (error) {
      console.error('User deletion error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new UserService(); 