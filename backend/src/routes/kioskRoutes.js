const express = require('express');
const kioskController = require('../controllers/kioskController');
const { requireCrmUser, requireKioskDevice } = require('../lib/kioskAuth');

const router = express.Router();

router.post('/pairing-codes', kioskController.createPairingCode);
router.post('/pairing-codes/claim', kioskController.claimPairingCode);

router.post('/pair', requireCrmUser, kioskController.pairDevice);
router.get('/devices', requireCrmUser, kioskController.listDevices);
router.patch('/devices/:id', requireCrmUser, kioskController.updateDevice);

router.get('/state', requireKioskDevice, kioskController.getState);
router.post('/heartbeat', requireKioskDevice, kioskController.heartbeat);

router.post('/display-sessions', requireCrmUser, kioskController.createDisplaySession);
router.delete('/display-sessions/:id', requireCrmUser, kioskController.cancelDisplaySession);

router.get('/display-sessions/:id/access', requireKioskDevice, kioskController.getSessionAccess);
router.post('/display-sessions/:id/complete', requireKioskDevice, kioskController.completeDisplaySession);
router.post('/display-sessions/:id/cancel', requireKioskDevice, kioskController.cancelDisplaySessionFromDevice);

module.exports = router;
