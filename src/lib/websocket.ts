import { io, Socket } from 'socket.io-client';

export interface MessageData {
  id: number;
  conversation_id: number;
  sender_id: string;
  content: string;
  message_type: 'text' | 'file' | 'image' | 'system';
  sent_at: string;
  edited_at?: string;
  is_deleted: boolean;
  attachment_url?: string;
  attachment_name?: string;
  attachment_type?: string;
  attachment_size?: number;
  reply_to_message_id?: number;
  reactions: any[];
  sender: {
    ids: string;
    full_name: string;
    email: string;
    employee_id?: number;
    tenants_employee?: {
      display_name: string;
      bonuses_role: string;
      photo_url?: string;
    };
  };
}

export interface TypingData {
  conversation_id: number;
  user_id: string;
  user_name: string;
  is_typing: boolean;
}

export interface ConversationUpdateData {
  conversation_id: number;
  last_message_at: string;
  last_message_preview: string;
  unread_count?: number;
}

class WebSocketService {
  private socket: Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private userId: string | null = null;

  // Event handlers
  private onMessageHandler: ((message: MessageData) => void) | null = null;
  // Typing indicators removed - no longer needed
  private onConversationUpdateHandler: ((update: ConversationUpdateData) => void) | null = null;
  private onConnectHandler: (() => void) | null = null;
  private onDisconnectHandler: (() => void) | null = null;
  private onUserOnlineHandler: ((userId: string) => void) | null = null;
  private onUserOfflineHandler: ((userId: string) => void) | null = null;
  private onOnlineStatusResponseHandler: ((onlineUsers: string[]) => void) | null = null;
  private onTypingHandler: ((data: TypingData) => void) | null = null;

  connect(userId: string): void {
    if (this.socket?.connected) {
      console.log('🔌 WebSocket already connected');
      return;
    }

    this.userId = userId; // Set the userId for use in sendMessage
    console.log('🔌 Connecting to WebSocket...');
    
      // Connect to the backend WebSocket server
      // In development: localhost:3001 (backend server)
      // In production: use VITE_WEBSOCKET_URL if set, otherwise use VITE_BACKEND_URL, fallback to localhost
      // Socket.IO automatically handles http/https to ws/wss conversion
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const serverUrl = import.meta.env.VITE_WEBSOCKET_URL || backendUrl;
      console.log('🔌 WebSocket server URL:', serverUrl);
      console.log('🔌 Environment check - VITE_WEBSOCKET_URL:', import.meta.env.VITE_WEBSOCKET_URL);
      console.log('🔌 Environment check - VITE_BACKEND_URL:', import.meta.env.VITE_BACKEND_URL);
    
    this.socket = io(serverUrl, {
      auth: {
        userId: userId
      },
      transports: ['polling', 'websocket'], // Try polling first
      timeout: 10000, // Increase timeout
      forceNew: true,
      reconnection: true, // Enable auto-reconnection
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      autoConnect: true,
      upgrade: true,
      rememberUpgrade: false,
      withCredentials: false, // Disable credentials for CORS compatibility
      extraHeaders: {} // Allow Socket.IO to handle headers
    });

    this.socket.on('connect', () => {
      console.log('🔌 WebSocket connected:', this.socket?.id);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Send join event with user ID
      if (userId) {
        this.socket?.emit('join', userId);
        console.log('👤 Sent join event for user:', userId);
        // Also emit user_online for the current user
        this.socket?.emit('user_online', String(userId));
      }
      
      this.onConnectHandler?.();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 WebSocket disconnected:', reason);
      this.isConnected = false;
      this.onDisconnectHandler?.();
    });

    this.socket.on('connect_error', (error) => {
      console.error('🔌 WebSocket connection error:', error);
      this.isConnected = false;
      // Auto-reconnection is handled by socket.io
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔌 WebSocket reconnected after', attemptNumber, 'attempts');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // Send join event with user ID on reconnect
      if (userId) {
        this.socket?.emit('join', userId);
        console.log('👤 Sent join event for user on reconnect:', userId);
      }
      
      this.onConnectHandler?.();
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('🔌 WebSocket reconnection error:', error);
      this.isConnected = false;
    });

    this.socket.on('reconnect_failed', () => {
      console.error('🔌 WebSocket reconnection failed after maximum attempts');
      this.isConnected = false;
      console.log('💡 To enable real-time messaging, start the WebSocket server with: npm run websocket');
    });

    // Message events
    this.socket.on('new_message', (message: MessageData) => {
      console.log('📨 New message received:', message);
      this.onMessageHandler?.(message);
    });

    this.socket.on('message_updated', (message: MessageData) => {
      console.log('📝 Message updated:', message);
      this.onMessageHandler?.(message);
    });

    this.socket.on('message_deleted', (messageId: number) => {
      console.log('🗑️ Message deleted:', messageId);
      // Handle message deletion
    });

    // Typing events
    this.socket.on('typing', (data: TypingData) => {
      console.log('⌨️ Typing event received:', data);
      this.onTypingHandler?.(data);
    });

    // Conversation events
    this.socket.on('conversation_updated', (update: ConversationUpdateData) => {
      console.log('💬 Conversation updated:', update);
      this.onConversationUpdateHandler?.(update);
    });

    this.socket.on('user_online', (userId: string) => {
      console.log('🟢 user_online event received:', userId);
      console.log('🟢 Handler exists:', !!this.onUserOnlineHandler);
      this.onUserOnlineHandler?.(userId);
    });

    this.socket.on('user_offline', (userId: string) => {
      console.log('🔴 user_offline event received:', userId);
      console.log('🔴 Handler exists:', !!this.onUserOfflineHandler);
      this.onUserOfflineHandler?.(userId);
    });

    // Message sent confirmation
    this.socket.on('message_sent', (message: MessageData) => {
      console.log('✅ Message sent confirmation:', message);
    });

    // Online status response - set up listener immediately
    this.socket.on('online_status_response', (data: any) => {
      console.log('📊 Received online_status_response event:', data);
      console.log('📊 Data type:', typeof data);
      console.log('📊 Data keys:', data ? Object.keys(data) : 'null');
      if (data && Array.isArray(data.online_users)) {
        console.log('📊 Online users from response:', data.online_users);
        this.onOnlineStatusResponseHandler?.(data.online_users);
      } else if (data && data.online_users) {
        console.log('📊 Online users from response (non-array):', data.online_users);
        this.onOnlineStatusResponseHandler?.(data.online_users);
      } else {
        console.error('❌ Invalid online_status_response data:', data);
      }
    });
    
    // Debug: Listen for ALL events to see what's coming through
    this.socket.onAny((eventName, ...args) => {
      if (eventName === 'user_online' || eventName === 'user_offline' || eventName === 'online_status_response') {
        console.log(`📡 Socket event received: ${eventName}`, args);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      console.log('🔌 Disconnecting WebSocket...');
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  // Send message
  sendMessage(
    conversationId: number, 
    content: string, 
    messageType: 'text' | 'file' | 'image' | 'system' = 'text', 
    attachmentUrl?: string, 
    attachmentType?: string, 
    attachmentSize?: number,
    replyToMessageId?: number
  ): void {
    if (!this.socket?.connected) {
      console.error('🔌 WebSocket not connected, cannot send message');
      return;
    }

    console.log('📤 Sending WebSocket message:', { conversation_id: conversationId, sender_id: this.userId, content, message_type: messageType, reply_to_message_id: replyToMessageId });
    console.log('📤 Socket connected:', this.socket.connected);
    console.log('📤 Socket ID:', this.socket.id);
    console.log('📤 User ID:', this.userId);
    
    this.socket.emit('send_message', {
      conversation_id: conversationId,
      sender_id: this.userId,
      content: content,
      message_type: messageType,
      sent_at: new Date().toISOString(),
      attachment_url: attachmentUrl,
      attachment_name: content, // Use content as attachment name for now
      attachment_type: attachmentType,
      attachment_size: attachmentSize,
      reply_to_message_id: replyToMessageId || null,
    });
    
    console.log('📤 Message emitted successfully');
  }

  // Send typing indicator
  sendTyping(conversationId: number, userId: string, userName: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit('typing', {
      conversation_id: conversationId,
      user_id: userId,
      user_name: userName,
      is_typing: isTyping
    });
  }

  // Join conversation room
  joinConversation(conversationId: number): void {
    if (!this.socket?.connected) return;

    this.socket.emit('join_conversation', conversationId);
  }

  // Leave conversation room
  leaveConversation(conversationId: number): void {
    if (!this.socket?.connected) return;

    this.socket.emit('leave_conversation', conversationId);
  }

  // Mark conversation as read
  markAsRead(conversationId: number, userId: string): void {
    if (!this.socket?.connected) return;

    this.socket.emit('mark_as_read', {
      conversation_id: conversationId,
      user_id: userId
    });
  }

  // Event handler setters
  onMessage(handler: (message: MessageData) => void): void {
    this.onMessageHandler = handler;
  }

  onTyping(handler: (data: TypingData) => void): void {
    this.onTypingHandler = handler;
  }

  onConversationUpdate(handler: (update: ConversationUpdateData) => void): void {
    this.onConversationUpdateHandler = handler;
  }

  onConnect(handler: () => void): void {
    this.onConnectHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.onDisconnectHandler = handler;
  }

  onUserOnline(handler: (userId: string) => void): void {
    this.onUserOnlineHandler = handler;
  }

  onUserOffline(handler: (userId: string) => void): void {
    this.onUserOfflineHandler = handler;
  }

  onOnlineStatusResponse(handler: (onlineUsers: string[]) => void): void {
    this.onOnlineStatusResponseHandler = handler;
  }

  // Request online status for specific users
  requestOnlineStatus(userIds: string[]): void {
    console.log('📤 requestOnlineStatus called with:', userIds.length, 'users');
    console.log('📤 Socket exists:', !!this.socket);
    console.log('📤 Socket connected:', this.socket?.connected);
    console.log('📤 isConnected flag:', this.isConnected);
    
    if (!this.socket) {
      console.error('❌ Cannot request online status: Socket is null');
      return;
    }
    
    if (!this.socket.connected) {
      console.error('❌ Cannot request online status: WebSocket not connected');
      console.error('❌ Socket state:', this.socket.connected ? 'connected' : 'disconnected');
      return;
    }
    
    console.log('📤 Emitting request_online_status with user_ids:', userIds);
    this.socket.emit('request_online_status', { user_ids: userIds });
    console.log('📤 request_online_status event emitted successfully');
  }

  // Utility methods
  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }

}

// Export singleton instance
export const websocketService = new WebSocketService();
export default websocketService;
