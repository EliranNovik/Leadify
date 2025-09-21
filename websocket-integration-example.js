// Example: Integrating WebSocket with Express.js backend
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = createServer(app);

// Enable CORS for your frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));

// Your existing API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', websocket: 'enabled' });
});

// WebSocket setup
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

// Your existing WebSocket logic here...
const activeUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", (userId) => {
    activeUsers.set(socket.id, userId);
    socket.userId = userId;
    console.log(`User ${userId} joined with socket ${socket.id}`);
  });

  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    const currentUserId = activeUsers.get(socket.id) || socket.id;
    console.log(`User ${currentUserId} joined conversation ${conversationId}`);
    
    io.to(socket.id).emit('room_joined', { 
      conversationId, 
      roomSize: io.sockets.adapter.rooms.get(`conversation_${conversationId}`)?.size || 0 
    });
  });

  socket.on("send_message", (data) => {
    const { conversation_id, content, message_type, attachment_url, attachment_name, attachment_type, attachment_size } = data;
    const userId = activeUsers.get(socket.id);

    if (userId) {
      const messageData = {
        id: Date.now(),
        conversation_id,
        sender_id: userId,
        content,
        message_type: message_type || "text",
        sent_at: new Date().toISOString(),
        attachment_url,
        attachment_name,
        attachment_type,
        attachment_size,
        sender: {
          ids: userId,
          full_name: userId,
        },
      };

      // Broadcast to all participants
      io.to(`conversation_${conversation_id}`).emit("message_received", messageData);
      console.log(`📨 Broadcasting message to conversation ${conversation_id}:`, content);
    }
  });

  socket.on("disconnect", (reason) => {
    const userId = activeUsers.get(socket.id);
    if (userId) {
      activeUsers.delete(socket.id);
      console.log(`User ${userId} disconnected - Reason: ${reason}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server enabled`);
  console.log(`🌐 Frontend should connect to: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
});

export { io }; // Export for use in other parts of your backend
