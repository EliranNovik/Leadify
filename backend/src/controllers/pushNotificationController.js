const pushNotificationService = require('../services/pushNotificationService');
const { notifyConversationParticipants } = require('../services/rmqNotificationService');
const meetingNotificationService = require('../services/meetingNotificationService');

/**
 * Send push notification to a user
 * POST /api/push/send
 * Body: { userId: string, payload: { title, body, icon, badge, url, etc. } }
 */
const sendPushNotification = async (req, res) => {
  try {
    const { userId, payload } = req.body;

    if (!userId || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing userId or payload'
      });
    }

    const result = await pushNotificationService.sendNotificationToUser(userId, payload);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error in sendPushNotification:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send push notification'
    });
  }
};

/**
 * Manually trigger meeting notification check
 * POST /api/push/meetings/check
 */
const checkMeetings = async (req, res) => {
  try {
    const result = await meetingNotificationService.checkAndNotifyMeetings();
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error in checkMeetings:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to check meetings'
    });
  }
};

module.exports = {
  sendPushNotification,
  checkMeetings,
  sendRmqNotification: async (req, res) => {
    try {
      const { conversationId, senderId, content, messageType, attachmentName } = req.body || {};

      if (!conversationId || !senderId) {
        return res.status(400).json({
          success: false,
          error: 'Missing conversationId or senderId',
        });
      }

      const result = await notifyConversationParticipants({
        conversationId,
        senderId,
        content,
        messageType,
        attachmentName,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('Error sending RMQ push notification:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to send RMQ notification',
      });
    }
  },
};

