const express = require('express');
const clientBookingController = require('../controllers/clientBookingController');

const router = express.Router();

router.post('/config', clientBookingController.config);
router.post('/slots', clientBookingController.slots);
router.post('/meetings', clientBookingController.meetings);
router.post('/book', clientBookingController.book);

module.exports = router;
