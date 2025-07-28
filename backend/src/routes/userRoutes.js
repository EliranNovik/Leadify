const express = require('express');
const userController = require('../controllers/userController');
require('dotenv').config();
const router = express.Router();

// Create a new user
router.post('/users', userController.createUser);

// Get all users
router.get('/users', userController.getAllUsers);

// Update user password
router.put('/users/:userId/password', userController.updateUserPassword);

// Update user details
router.put('/users/:userId', userController.updateUser);

// Delete user
router.delete('/users/:userId', userController.deleteUser);

module.exports = router; 