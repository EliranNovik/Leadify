import { Server } from "socket.io";
import http from "http";

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for development
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store active connections
const activeUsers = new Map();
// Typing indicators removed - no longer needed

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins with their ID (this is called when WebSocket connects)
  socket.on("join", (userId) => {
    activeUsers.set(socket.id, userId);
    socket.userId = userId;
    console.log(`User ${userId} joined with socket ${socket.id}`);
    
    // Emit user_online event to all clients (including the connecting user)
    io.emit("user_online", String(userId));
    console.log(`🟢 Emitted user_online for user ${userId}`);
  });

  // Join conversation room
  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    const currentUserId = activeUsers.get(socket.id) || socket.id;
    console.log(`User ${currentUserId} joined conversation ${conversationId}`);
    
    // Send room info to client
    io.to(socket.id).emit('room_joined', { 
      conversationId, 
      roomSize: io.sockets.adapter.rooms.get(`conversation_${conversationId}`)?.size || 0 
    });
  });

  // Leave conversation room
  socket.on("leave_conversation", (conversationId) => {
    const userId = activeUsers.get(socket.id);
    socket.leave(`conversation_${conversationId}`);
    
    // Typing indicators removed - no cleanup needed
    
    console.log(`User left conversation ${conversationId}`);
  });

  // Send message
  socket.on("send_message", (data) => {
    const { conversation_id, content, message_type } = data;
    const userId = activeUsers.get(socket.id);

    if (userId) {
      const messageData = {
        id: Date.now(), // Temporary ID
        conversation_id,
        sender_id: userId,
        content,
        message_type: message_type || "text",
        sent_at: new Date().toISOString(),
        sender: {
          ids: userId,
          full_name: userId, // Use the actual user ID for now
        },
      };

      // Clear typing indicator for this user when message is sent
      // Typing indicators removed - no cleanup needed

      // Get the room to see how many people are in it
      const room = io.sockets.adapter.rooms.get(`conversation_${conversation_id}`);
      const roomSize = room ? room.size : 0;
      
      console.log(`📨 Broadcasting message to conversation ${conversation_id} (${roomSize} participants):`, content);
      
      // Always ensure sender is in the room
      if (!socket.rooms.has(`conversation_${conversation_id}`)) {
        socket.join(`conversation_${conversation_id}`);
        console.log(`📨 Added sender to conversation ${conversation_id} room`);
      }
      
      // Get updated room size
      const updatedRoom = io.sockets.adapter.rooms.get(`conversation_${conversation_id}`);
      const updatedRoomSize = updatedRoom ? updatedRoom.size : 0;
      
      console.log(`📨 Broadcasting message to conversation ${conversation_id} (${updatedRoomSize} participants):`, content);
      
      // Broadcast to ALL participants in the conversation room (including sender)
      io.to(`conversation_${conversation_id}`).emit("new_message", messageData);
      
      // Also emit to the sender to confirm delivery
      socket.emit("message_sent", messageData);
    } else {
      console.log(`❌ User not found for socket ${socket.id} when trying to send message`);
    }
  });

  // Typing indicators removed - no longer needed

  // Mark as read
  socket.on("mark_as_read", (data) => {
    const { conversation_id, user_id } = data;
    // Handle marking messages as read
    console.log(
      `User ${user_id} marked conversation ${conversation_id} as read`
    );
  });

  socket.on("disconnect", (reason) => {
    const userId = activeUsers.get(socket.id);
    if (userId) {
      activeUsers.delete(socket.id);
      
      // Emit user_offline event to all clients
      io.emit("user_offline", String(userId));
      console.log(`🔴 Emitted user_offline for user ${userId} - Reason: ${reason}`);
      
      // Typing indicators removed - no cleanup needed
      console.log(`User ${userId} disconnected - Reason: ${reason}`);
    } else {
      console.log(`Socket ${socket.id} disconnected - Reason: ${reason}`);
    }
  });

  // Handle request for online status
  socket.on("request_online_status", (data) => {
    const { user_ids } = data;
    if (!Array.isArray(user_ids)) {
      console.log('❌ Invalid request_online_status data:', data);
      return;
    }
    
    console.log(`📊 Received online status request for ${user_ids.length} users`);
    console.log(`📊 Currently active users:`, Array.from(activeUsers.values()));
    
    // Get all currently online user IDs (convert to strings for consistency)
    const onlineUserIds = new Set();
    const requestedUserIdsStr = user_ids.map(id => String(id));
    
    activeUsers.forEach((userId) => {
      const userIdStr = String(userId);
      if (requestedUserIdsStr.includes(userIdStr)) {
        onlineUserIds.add(userIdStr);
        console.log(`✅ User ${userIdStr} is online`);
      }
    });
    
    const response = {
      online_users: Array.from(onlineUserIds)
    };
    
    console.log(`📊 Sending online status response: ${onlineUserIds.size} users online`);
    console.log(`📊 Online users:`, Array.from(onlineUserIds));
    
    // Send back the online status for requested users
    socket.emit("online_status_response", response);
  });

  // Handle connection errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Typing indicators removed - no cleanup needed

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  console.log(`Frontend should connect to: ws://localhost:${PORT}`);
});
