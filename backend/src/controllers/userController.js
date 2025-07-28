const userService = require('../services/userService');
require('dotenv').config();


class UserController {
  /**
   * Create a new user
   */
  createUser = async (req, res) => {
    try {
      const userData = req.body;
      
      // Validate required fields
      if (!userData.email || !userData.password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      const result = await userService.createUser(userData);

      if (result.success) {
        return res.status(201).json({
          success: true,
          message: 'User created successfully',
          user: result.user
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Create user controller error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Get all users
   */
  getAllUsers = async (req, res) => {
    try {
      const result = await userService.getAllUsers();

      if (result.success) {
        return res.status(200).json({
          success: true,
          users: result.users
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Get users controller error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Update user password
   */
  updateUserPassword = async (req, res) => {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;

      if (!newPassword) {
        return res.status(400).json({
          success: false,
          error: 'New password is required'
        });
      }

      const result = await userService.updateUserPassword(userId, newPassword);

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Update password controller error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Update user details
   */
  updateUser = async (req, res) => {
    try {
      const { userId } = req.params;
      const updateData = req.body;

      const result = await userService.updateUser(userId, updateData);

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: 'User updated successfully',
          user: result.user
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Update user controller error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }

  /**
   * Delete user
   */
  deleteUser = async (req, res) => {
    try {
      const { userId } = req.params;

      const result = await userService.deleteUser(userId);

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message
        });
      } else {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Delete user controller error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
}

module.exports = new UserController(); 