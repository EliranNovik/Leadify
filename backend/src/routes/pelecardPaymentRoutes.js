const express = require('express');
const controller = require('../controllers/pelecardPaymentController');

const router = express.Router();

router.post('/create-payment-session', controller.createPaymentSession);
router.get('/checkout-css-info', controller.getCheckoutCssInfo);
router.get('/status/:paymentId', controller.getPaymentStatus);

router.get('/return/success', controller.returnSuccess);
router.post('/return/success', controller.returnSuccess);
router.get('/return/error', controller.returnError);
router.post('/return/error', controller.returnError);
router.get('/return/cancel', controller.returnCancel);
router.post('/return/cancel', controller.returnCancel);

module.exports = router;
