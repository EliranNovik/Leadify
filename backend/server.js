const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const userRoutes = require('./src/routes/userRoutes');
const teamsCallingRoutes = require('./src/routes/teamsCallingRoutes');
const teamsBotRoutes = require('./src/routes/teamsBotRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes');
const whatsappRoutes = require('./src/routes/whatsappRoutes');
const accessLogger = require('./src/middleware/accessLogger');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;

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

// Store active WebSocket connections
const activeUsers = new Map();

// WebSocket connection handling
io.on("connection", (socket) => {
  console.log(`🔌 WebSocket user connected: ${socket.id}`);

  // User joins with their ID
  socket.on("join", (userId) => {
    activeUsers.set(socket.id, userId);
    socket.userId = userId;
    console.log(`👤 User ${userId} joined with socket ${socket.id}`);
  });

  // Join conversation room
  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation-${conversationId}`);
    const currentUserId = activeUsers.get(socket.id) || socket.id;
    console.log(`🏠 User ${currentUserId} joined conversation ${conversationId}`);
    
    io.to(socket.id).emit('room_joined', { 
      conversationId, 
      roomSize: io.sockets.adapter.rooms.get(`conversation-${conversationId}`)?.size || 0 
    });
  });

  // Leave conversation room
  socket.on("leave_conversation", (conversationId) => {
    socket.leave(`conversation-${conversationId}`);
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
    
    io.to(roomName).emit('new_message', messageData);
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

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Additional CORS headers for preflight requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Access logging middleware
app.use(accessLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    websocket: {
      connections: activeUsers.size,
      enabled: true
    }
  });
});

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB limit
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

// API routes
app.use('/api', userRoutes);
app.use('/api/teams', teamsCallingRoutes);
app.use('/api/teams/bot', teamsBotRoutes);
app.use('/api', webhookRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Serve uploaded files
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server enabled`);
  console.log(`🌐 Frontend should connect to: ${process.env.FRONTEND_URL || "http://localhost:5173"}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io }; 