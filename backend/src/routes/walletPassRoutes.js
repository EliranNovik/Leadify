const express = require('express');
const walletPassController = require('../controllers/walletPassController');

const router = express.Router();

router.get('/status', walletPassController.status);
router.get('/business-card/:employeeId/apple', walletPassController.applePass);
router.get('/business-card/:employeeId/google', walletPassController.googlePass);
router.get('/business-card/:employeeId/google/redirect', walletPassController.googlePassRedirect);

module.exports = router;
