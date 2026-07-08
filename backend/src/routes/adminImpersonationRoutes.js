const express = require('express');
const adminImpersonationController = require('../controllers/adminImpersonationController');
const { requireSuperuser } = require('../lib/adminAuth');

const router = express.Router();

router.post('/admin/impersonate-worker', requireSuperuser, adminImpersonationController.impersonateWorker);

module.exports = router;
