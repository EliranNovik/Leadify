import { useRef } from 'react';
import { supabase } from '../lib/supabase';
import { sendBellNotification } from '../lib/pushNotificationService';

/**
 * Hook to send push notifications for bell icon notifications
 * Only sends notifications for NEW messages that arrive AFTER the app loads
 * Tracks notified message IDs to prevent duplicate notifications
 */
export function usePushNotifications() {
  const previousUnreadCountRef = useRef<number | null>(null); // null = not initialized
  const previousWhatsappCountRef = useRef<number | null>(null);
  const previousRmqCountRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);
  const notifiedWhatsappMessageIdsRef = useRef<Set<string>>(new Set());
  const notifiedRmqMessageIdsRef = useRef<Set<string>>(new Set());

  const sendNotificationForNewMessage = async (
    unreadCount: number,
    whatsappCount: number,
    rmqCount: number,
    whatsappMessages: any[],
    rmqMessages: any[]
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const pushEnabled = localStorage.getItem('pushNotifications') !== 'false';
      if (!pushEnabled) return;

      // On first call, initialize refs with current counts and message IDs to prevent notifications for existing messages
      if (!isInitializedRef.current) {
        previousUnreadCountRef.current = unreadCount;
        previousWhatsappCountRef.current = whatsappCount;
        previousRmqCountRef.current = rmqCount;
        
        // Mark all existing WhatsApp messages as already notified
        // Use stable message IDs - prefer database ID, fallback to phone + sent_at
        whatsappMessages.forEach((msg: any) => {
          const messageId = msg.id || 
                           msg.whatsapp_message_id || 
                           `${msg.phone_number}-${msg.sent_at || msg.latest_message_time || msg.latest_message}`;
          if (messageId) {
            notifiedWhatsappMessageIdsRef.current.add(String(messageId));
          }
        });
        
        // Mark all existing RMQ messages as already notified
        rmqMessages.forEach((msg: any) => {
          const messageId = msg.id || String(msg.id);
          if (messageId) {
            notifiedRmqMessageIdsRef.current.add(String(messageId));
          }
        });
        
        isInitializedRef.current = true;
        console.log('🔔 Push notifications initialized. Existing messages marked as notified:', {
          whatsapp: notifiedWhatsappMessageIdsRef.current.size,
          rmq: notifiedRmqMessageIdsRef.current.size
        });
        return; // Don't send notifications for messages that were already there
      }

      // Check if there are new WhatsApp messages (count increased AND new message IDs)
      if (whatsappMessages.length > 0) {
        const latestMessage = whatsappMessages[0];
        // Use a more stable message ID - prefer database ID, fallback to phone + sent_at
        const messageId = latestMessage.id || 
                         latestMessage.whatsapp_message_id || 
                         `${latestMessage.phone_number}-${latestMessage.sent_at || latestMessage.latest_message_time}`;
        const messageIdStr = String(messageId);
        
        // Only send notification if:
        // 1. This is a new message (not already notified)
        // 2. Count actually increased (not just initialized)
        const countIncreased = previousWhatsappCountRef.current !== null && 
                               whatsappCount > previousWhatsappCountRef.current;
        
        if (!notifiedWhatsappMessageIdsRef.current.has(messageIdStr) && countIncreased) {
          const senderName = latestMessage.sender_name && latestMessage.sender_name !== latestMessage.phone_number
            ? latestMessage.sender_name
            : latestMessage.phone_number;

          await sendBellNotification(user.id, {
            id: `whatsapp-${messageIdStr}`,
            title: '💬 New WhatsApp Message',
            body: `${senderName}: ${latestMessage.latest_message?.substring(0, 50) || 'New message'}...`,
            url: '/whatsapp-leads',
            icon: '/whatsapp-icon.svg',
            type: 'whatsapp',
          });
          
          // Mark this message as notified
          notifiedWhatsappMessageIdsRef.current.add(messageIdStr);
          console.log('📱 Sent WhatsApp push notification for message:', messageIdStr);
        } else if (!notifiedWhatsappMessageIdsRef.current.has(messageIdStr)) {
          // Mark as notified even if count didn't increase (to prevent future notifications)
          notifiedWhatsappMessageIdsRef.current.add(messageIdStr);
        }
      }

      // Check if there are new RMQ messages (count increased AND new message IDs)
      if (rmqMessages.length > 0) {
        const latestMessage = rmqMessages[0];
        const messageId = String(latestMessage.id || latestMessage.id);
        
        // Only send notification if:
        // 1. This is a new message (not already notified)
        // 2. Count actually increased (not just initialized)
        const countIncreased = previousRmqCountRef.current !== null && 
                               rmqCount > previousRmqCountRef.current;
        
        if (!notifiedRmqMessageIdsRef.current.has(messageId) && countIncreased) {
          const senderName = latestMessage.sender?.full_name || 'Someone';

          await sendBellNotification(user.id, {
            id: `rmq-${messageId}`,
            title: '💬 New Message',
            body: `${senderName}: ${latestMessage.content?.substring(0, 50) || 'New message'}...`,
            url: '/messaging',
            type: 'rmq',
          });
          
          // Mark this message as notified
          notifiedRmqMessageIdsRef.current.add(messageId);
          console.log('📱 Sent RMQ push notification for message:', messageId);
        } else if (!notifiedRmqMessageIdsRef.current.has(messageId)) {
          // Mark as notified even if count didn't increase (to prevent future notifications)
          notifiedRmqMessageIdsRef.current.add(messageId);
        }
      }

      // Update refs
      previousUnreadCountRef.current = unreadCount;
      previousWhatsappCountRef.current = whatsappCount;
      previousRmqCountRef.current = rmqCount;
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  };

  return { sendNotificationForNewMessage };
}

