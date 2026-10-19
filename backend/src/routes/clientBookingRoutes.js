const express = require('express');
const clientBookingController = require('../controllers/clientBookingController');

const router = express.Router();

router.post('/config', clientBookingController.config);
router.post('/slots', clientBookingController.slots);
router.post('/meetings', clientBookingController.meetings);
router.post('/book', clientBookingController.book);
// Staff-side: puts a saved CRM meeting on the shared Outlook calendar (RMQ AI).
router.post('/calendar-event', clientBookingController.calendarEvent);

module.exports = router;
