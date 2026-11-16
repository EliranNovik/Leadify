const express = require('express');
const controller = require('../controllers/clockInOvertimeApprovalController');

const router = express.Router();

router.post('/overtime-approval/request', controller.requestOvertimeApproval);

module.exports = router;
