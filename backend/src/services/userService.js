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

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', email)
        .single();

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create user in Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
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

      // Create user in custom users table
      const { data: customUser, error: customError } = await supabase
        .from('users')
        .insert({
          auth_id: authUser.user.id,
          email,
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
      const { data: user, error } = await supabase
        .from('users')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
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