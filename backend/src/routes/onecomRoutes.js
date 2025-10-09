const express = require('express');
const router = express.Router();
const OneComSyncService = require('../services/onecomSyncService');

const onecomSync = new OneComSyncService();

/**
 * POST /api/onecom/sync
 * Sync call logs from 1com to database
 */
router.post('/sync', async (req, res) => {
  try {
    const { startDate, endDate, extensions } = req.body;

    // Validate required parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Dates must be in YYYY-MM-DD format'
      });
    }

    // Validate date range (max 30 days)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return res.status(400).json({
        success: false,
        error: 'Date range cannot exceed 30 days'
      });
    }

    console.log(`🔄 Starting sync request: ${startDate} to ${endDate}${extensions ? ` for extensions: ${extensions}` : ''}`);

    // Perform sync
    const result = await onecomSync.syncCallLogs(startDate, endDate, extensions);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/test
 * Test 1com API connection
 */
router.get('/test', async (req, res) => {
  try {
    const isConnected = await onecomSync.testConnection();
    
    res.json({
      success: isConnected,
      message: isConnected ? 'Connection successful' : 'Connection failed',
      connected: isConnected
    });
  } catch (error) {
    console.error('❌ Error testing 1com connection:', error);
    res.status(500).json({
      success: false,
      error: 'Connection test failed',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/stats
 * Get sync statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await onecomSync.getSyncStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error getting sync stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/extensions
 * Get available extensions from 1com
 */
router.get('/extensions', async (req, res) => {
  try {
    const extensions = await onecomSync.getExtensions();
    
    res.json({
      success: true,
      data: extensions
    });
  } catch (error) {
    console.error('❌ Error getting extensions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get extensions',
      message: error.message
    });
  }
});

/**
 * POST /api/onecom/sync/last-week
 * Quick sync for the last 7 days
 */
router.post('/sync/last-week', async (req, res) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`🔄 Quick sync for last week: ${startDateStr} to ${endDateStr}`);

    const result = await onecomSync.syncCallLogs(startDateStr, endDateStr);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          dateRange: `${startDateStr} to ${endDateStr}`,
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in quick sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/onecom/sync/today
 * Quick sync for today
 */
router.post('/sync/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    console.log(`🔄 Quick sync for today: ${today}`);

    const result = await onecomSync.syncCallLogs(today, today);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          dateRange: today,
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in today sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/recording/:uniqueId
 * Fetch recording data for a specific call
 */
router.get('/recording/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({
        success: false,
        error: 'uniqueId is required'
      });
    }

    console.log(`🎵 Fetching recording for ${uniqueId}`);

    const recordingData = await onecomSync.fetchRecordingData(uniqueId);

    if (recordingData && recordingData.available) {
      res.json({
        success: true,
        data: recordingData
      });
    } else {
      res.json({
        success: false,
        message: 'No recording available for this call',
        data: null
      });
    }

  } catch (error) {
    console.error('❌ Error fetching recording:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recording',
      message: error.message
    });
  }
});

module.exports = router;
