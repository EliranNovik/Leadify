const express = require('express');
const smartScanController = require('../controllers/smartScanController');

const router = express.Router();

router.get('/smart-scan/inbox', smartScanController.inbox);
router.post('/smart-scan/sync', smartScanController.sync);
router.post('/smart-scan/process', smartScanController.process);
router.post('/smart-scan/process/:id', smartScanController.process);
router.post('/smart-scan/assign', smartScanController.assign);
router.post('/smart-scan/split-case-document', smartScanController.splitCaseDocument);
router.post('/smart-scan/approve', smartScanController.approve);
router.delete('/smart-scan/items/:id', smartScanController.remove);
router.post('/smart-scan/remove', smartScanController.remove);
router.get('/smart-scan/documents/:documentId/file', smartScanController.downloadDocument);
router.get('/smart-scan/attachments/:emailId/:attachmentId', smartScanController.downloadAttachment);

module.exports = router;
