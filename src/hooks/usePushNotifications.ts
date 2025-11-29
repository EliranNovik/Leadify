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
        whatsappMessages.forEach((msg: any) => {
          const messageId = msg.id || msg.whatsapp_message_id || `${msg.phone_number}-${msg.latest_message}`;
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

      // Check if there are new WhatsApp messages (count increased OR new message IDs)
      if (whatsappMessages.length > 0) {
        const latestMessage = whatsappMessages[0];
        const messageId = latestMessage.id || latestMessage.whatsapp_message_id || `${latestMessage.phone_number}-${latestMessage.latest_message}`;
        const messageIdStr = String(messageId);
        
        // Only send notification if this is a new message (not already notified)
        if (!notifiedWhatsappMessageIdsRef.current.has(messageIdStr)) {
          // Also check if count increased (additional safety check)
          const countIncreased = previousWhatsappCountRef.current !== null && 
                                 whatsappCount > previousWhatsappCountRef.current;
          
          if (countIncreased || previousWhatsappCountRef.current === null) {
            const senderName = latestMessage.sender_name && latestMessage.sender_name !== latestMessage.phone_number
              ? latestMessage.sender_name
              : latestMessage.phone_number;

            await sendBellNotification(user.id, {
              id: `whatsapp-${messageIdStr}`,
              title: '💬 New WhatsApp Message',
              body: `${senderName}: ${latestMessage.latest_message?.substring(0, 50) || 'New message'}...`,
              url: '/whatsapp-leads',
              icon: '/whatsapp-icon.svg',
            });
            
            // Mark this message as notified
            notifiedWhatsappMessageIdsRef.current.add(messageIdStr);
            console.log('📱 Sent WhatsApp push notification for message:', messageIdStr);
          }
        }
      }

      // Check if there are new RMQ messages (count increased OR new message IDs)
      if (rmqMessages.length > 0) {
        const latestMessage = rmqMessages[0];
        const messageId = String(latestMessage.id || latestMessage.id);
        
        // Only send notification if this is a new message (not already notified)
        if (!notifiedRmqMessageIdsRef.current.has(messageId)) {
          // Also check if count increased (additional safety check)
          const countIncreased = previousRmqCountRef.current !== null && 
                                 rmqCount > previousRmqCountRef.current;
          
          if (countIncreased || previousRmqCountRef.current === null) {
            const senderName = latestMessage.sender?.full_name || 'Someone';

            await sendBellNotification(user.id, {
              id: `rmq-${messageId}`,
              title: '💬 New Message',
              body: `${senderName}: ${latestMessage.content?.substring(0, 50) || 'New message'}...`,
              url: '/messaging',
            });
            
            // Mark this message as notified
            notifiedRmqMessageIdsRef.current.add(messageId);
            console.log('📱 Sent RMQ push notification for message:', messageId);
          }
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

