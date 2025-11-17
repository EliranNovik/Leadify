const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.get('/auth/login', authController.login);
router.get('/auth/callback', authController.callback);
router.get('/auth/status', authController.status);
router.post('/auth/disconnect', authController.disconnect);

module.exports = router;


