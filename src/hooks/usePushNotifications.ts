import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { sendBellNotification } from '../lib/pushNotificationService';

/**
 * Hook to send push notifications for bell icon notifications
 */
export function usePushNotifications() {
  const previousUnreadCountRef = useRef(0);
  const previousWhatsappCountRef = useRef(0);
  const previousRmqCountRef = useRef(0);

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

      // Check if there are new WhatsApp messages
      if (whatsappCount > previousWhatsappCountRef.current && whatsappMessages.length > 0) {
        const latestMessage = whatsappMessages[0];
        const senderName = latestMessage.sender_name && latestMessage.sender_name !== latestMessage.phone_number
          ? latestMessage.sender_name
          : latestMessage.phone_number;

        await sendBellNotification(user.id, {
          id: `whatsapp-${latestMessage.phone_number}`,
          title: '💬 New WhatsApp Message',
          body: `${senderName}: ${latestMessage.latest_message?.substring(0, 50) || 'New message'}...`,
          url: '/whatsapp-leads',
        });
      }

      // Check if there are new RMQ messages
      if (rmqCount > previousRmqCountRef.current && rmqMessages.length > 0) {
        const latestMessage = rmqMessages[0];
        const senderName = latestMessage.sender?.full_name || 'Someone';

        await sendBellNotification(user.id, {
          id: `rmq-${latestMessage.id}`,
          title: '💬 New Message',
          body: `${senderName}: ${latestMessage.content?.substring(0, 50) || 'New message'}...`,
          url: '/messaging',
        });
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

