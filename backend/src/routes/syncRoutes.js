const express = require('express');
const syncController = require('../controllers/syncController');

const router = express.Router();

router.post('/sync/now', syncController.syncNow);

module.exports = router;


