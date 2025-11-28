const supabase = require('../config/supabase');
const pushNotificationService = require('./pushNotificationService');

const getUserDisplayName = async (userId) => {
  if (!userId) return 'Team Member';
  try {
    const { data, error } = await supabase
      .from('users')
      .select('full_name, tenants_employee!users_employee_id_fkey(display_name)')
      .eq('id', userId)
      .limit(1)
      .single();

    if (error) {
      console.warn('⚠️  Unable to fetch user display name:', error.message || error);
      return 'Team Member';
    }

    return (
      data?.tenants_employee?.display_name ||
      data?.full_name ||
      'Team Member'
    );
  } catch (error) {
    console.warn('⚠️  Error fetching user display name:', error.message || error);
    return 'Team Member';
  }
};

const buildRmqPreview = (senderName, content, messageType, attachmentName) => {
  const prefix = senderName ? `${senderName}: ` : '';

  if (messageType === 'file' || messageType === 'image') {
    if (attachmentName) {
      return `${prefix}Sent a file: ${attachmentName}`;
    }
    return `${prefix}Sent an attachment`;
  }

  const trimmedContent = (content || '').trim();
  if (trimmedContent.length > 0) {
    return `${prefix}${trimmedContent.substring(0, 80)}`;
  }

  return `${prefix}Sent a message`;
};

const notifyConversationParticipants = async ({
  conversationId,
  senderId,
  content,
  messageType = 'text',
  attachmentName,
}) => {
  if (!conversationId) {
    throw new Error('conversationId is required for RMQ notifications');
  }

  try {
    const { data: participants, error: participantsError } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('is_active', true);

    if (participantsError) {
      throw new Error(participantsError.message || 'Failed to fetch conversation participants');
    }

    const recipientIds = (participants || [])
      .map((participant) => participant.user_id)
      .filter((userId) => userId && userId !== senderId);

    if (!recipientIds.length) {
      return { success: true, sent: 0, total: 0, message: 'No participants to notify' };
    }

    const senderName = await getUserDisplayName(senderId);
    const previewText = buildRmqPreview(senderName, content, messageType, attachmentName);

    await Promise.all(
      recipientIds.map(async (userId) => {
        try {
          await pushNotificationService.sendNotificationToUser(userId, {
            title: '💬 New RMQ Message',
            body: previewText,
            icon: '/icon-192x192.png',
            badge: '/icon-72x72.png',
            url: '/',
            type: 'rmq',
            id: `rmq-${conversationId}-${Date.now()}`,
            tag: `rmq-${conversationId}`,
            vibrate: [200, 100, 200],
          });
        } catch (notificationError) {
          console.error(`❌ Error sending RMQ notification to user ${userId}:`, notificationError);
        }
      })
    );

    return { success: true, sent: recipientIds.length, total: recipientIds.length };
  } catch (error) {
    console.error('❌ Failed to send RMQ conversation notifications:', error);
    throw error;
  }
};

module.exports = {
  notifyConversationParticipants,
};

