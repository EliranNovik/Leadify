const express = require('express');
const clockInKioskController = require('../controllers/clockInKioskController');

const router = express.Router();

/** GET /api/clock-in-kiosk/current?locationId=1 — public (tablet kiosk). */
router.get('/current', clockInKioskController.getCurrent);

/** POST /api/clock-in-kiosk/validate — public (phone scan handler). */
router.post('/validate', clockInKioskController.validate);

/** POST /api/clock-in-kiosk/announce — phone notifies tablet of successful clock-in. */
router.post('/announce', clockInKioskController.announce);

/** GET /api/clock-in-kiosk/recent-event?locationId=1 — tablet polls for success flash. */
router.get('/recent-event', clockInKioskController.recentEvent);

/** GET /api/clock-in-kiosk/display?locationId=1 — tablet widgets + settings bundle. */
router.get('/display', clockInKioskController.display);

/** GET /api/clock-in-kiosk/meetings-today?locationId=1 — full meetings list for kiosk detail screen. */
router.get('/meetings-today', clockInKioskController.meetingsToday);

/** POST /api/clock-in-kiosk/meeting-clock-adjustment — meeting-aware clock in/out times + remark. */
router.post('/meeting-clock-adjustment', clockInKioskController.meetingClockAdjustment);

module.exports = router;
