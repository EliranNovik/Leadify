import { Server } from "socket.io";
import http from "http";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
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

// Health check endpoint
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      connections: activeUsers.size,
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Server - Use WebSocket connection');
  }
});

io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // User joins with their ID
  socket.on("join", (userId) => {
    activeUsers.set(socket.id, userId);
    socket.userId = userId;
    console.log(`👤 User ${userId} joined with socket ${socket.id}`);
  });

  // Join conversation room
  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    const currentUserId = activeUsers.get(socket.id) || socket.id;
    console.log(`🏠 User ${currentUserId} joined conversation ${conversationId}`);
    
    io.to(socket.id).emit('room_joined', { 
      conversationId, 
      roomSize: io.sockets.adapter.rooms.get(`conversation_${conversationId}`)?.size || 0 
    });
  });

  // Leave conversation room
  socket.on("leave_conversation", (conversationId) => {
    socket.leave(`conversation_${conversationId}`);
    console.log(`🚪 User left conversation ${conversationId}`);
  });

  // Send message
  socket.on("send_message", async ({ conversation_id, sender_id, content, message_type, sent_at, attachment_url, attachment_name, attachment_type, attachment_size }) => {
    console.log(`📨 Received message from ${sender_id} for conversation ${conversation_id}: ${content} (Type: ${message_type})`);
    
    const messageData = {
      conversation_id,
      sender_id,
      content,
      message_type,
      sent_at,
      attachment_url,
      attachment_name,
      attachment_type,
      attachment_size,
    };
    
    // Broadcast message to all participants in the conversation room
    const roomName = `conversation-${conversation_id}`;
    const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
    
    // If the sender is the only one in the room, ensure they receive their own message
    if (roomSize === 0) {
      socket.join(roomName);
      console.log(`User ${sender_id} explicitly joined conversation ${conversation_id} for message broadcast.`);
    }
    
    io.to(roomName).emit('message_received', messageData);
    console.log(`📨 Broadcasting message to conversation ${conversation_id} (${roomSize} participants): ${content}`);
  });

  // Mark as read
  socket.on("mark_as_read", (data) => {
    const { conversation_id, user_id } = data;
    console.log(`✅ User ${user_id} marked conversation ${conversation_id} as read`);
  });

  socket.on("disconnect", (reason) => {
    const userId = activeUsers.get(socket.id);
    if (userId) {
      activeUsers.delete(socket.id);
      console.log(`👋 User ${userId} disconnected - Reason: ${reason}`);
    } else {
      console.log(`🔌 Socket ${socket.id} disconnected - Reason: ${reason}`);
    }
  });

  socket.on("error", (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
});

const PORT = process.env.WEBSOCKET_PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on port ${PORT}`);
  console.log(`🌐 Frontend should connect to: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ WebSocket server closed');
    process.exit(0);
  });
});
