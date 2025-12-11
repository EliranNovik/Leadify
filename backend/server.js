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
const onecomRoutes = require('./src/routes/onecomRoutes');
const authRoutes = require('./src/routes/authRoutes');
const emailRoutes = require('./src/routes/emailRoutes');
const syncRoutes = require('./src/routes/syncRoutes');
const pushNotificationRoutes = require('./src/routes/pushNotificationRoutes');
const { startMailboxSyncScheduler } = require('./src/services/mailboxSyncScheduler');
const { startMeetingNotificationScheduler } = require('./src/services/meetingNotificationScheduler');
const accessLogger = require('./src/middleware/accessLogger');
const { notifyConversationParticipants } = require('./src/services/rmqNotificationService');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;

// WebSocket setup
const io = new Server(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173",
      "https://leadify-crm.onrender.com",
      "https://rainmakerqueen.org",
      "http://localhost:5173", 
    ],
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
    
    // Emit user_online event to all clients (including the connecting user)
    io.emit("user_online", String(userId));
    console.log(`🟢 Emitted user_online for user ${userId}`);
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

    notifyConversationParticipants({
      conversationId: conversation_id,
      senderId: sender_id,
      content,
      messageType: message_type,
      attachmentName: attachment_name,
    }).catch((err) => {
      console.error('❌ Error sending RMQ push notification:', err);
    });
  });

  // Mark as read
  socket.on("mark_as_read", (data) => {
    const { conversation_id, user_id } = data;
    console.log(`✅ User ${user_id} marked conversation ${conversation_id} as read`);
  });

  // Typing indicator
  socket.on("typing", (data) => {
    const { conversation_id, user_id, user_name, is_typing } = data;
    console.log(`⌨️ User ${user_name} (${user_id}) is ${is_typing ? 'typing' : 'stopped typing'} in conversation ${conversation_id}`);
    
    // Broadcast typing status to all participants in the conversation room (except the sender)
    const roomName = `conversation-${conversation_id}`;
    socket.to(roomName).emit('typing', {
      conversation_id,
      user_id,
      user_name,
      is_typing
    });
  });

  // Request online status handler
  socket.on("request_online_status", (data) => {
    const { user_ids } = data;
    if (!Array.isArray(user_ids)) {
      console.error('❌ Invalid request_online_status data:', data);
      return;
    }
    
    const onlineUserIds = new Set();
    activeUsers.forEach((userId) => {
      const userIdStr = String(userId);
      if (user_ids.map(id => String(id)).includes(userIdStr)) {
        onlineUserIds.add(userIdStr);
      }
    });
    
    console.log(`📊 Received online status request for ${user_ids.length} users`);
    console.log(`📊 Currently active users: ${Array.from(activeUsers.values())}`);
    console.log(`📊 Sending online status response: ${onlineUserIds.size} users online`);
    
    socket.emit("online_status_response", {
      online_users: Array.from(onlineUserIds)
    });
  });

  socket.on("disconnect", (reason) => {
    const userId = activeUsers.get(socket.id);
    if (userId) {
      activeUsers.delete(socket.id);
      console.log(`👋 User ${userId} disconnected - Reason: ${reason}`);
      
      // Emit user_offline event to all clients
      io.emit("user_offline", String(userId));
      console.log(`🔴 Emitted user_offline for user ${userId}`);
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

// Call recording proxy endpoint
app.get('/api/call-recording/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const { tenant } = req.query;
    
    console.log('🎵 Proxying call recording request for call ID:', callId, 'tenant:', tenant);
    
    // Get 1com API configuration
    const onecomApiKey = process.env.ONECOM_API_KEY;
    const onecomTenant = tenant || process.env.ONECOM_TENANT || 'decker';
    
    if (!onecomApiKey) {
      console.error('🎵 1com API key not configured');
      return res.status(500).json({ error: 'API key not configured' });
    }
    
        // Try both API parameters as per documentation
        // Documentation shows: info=recording
        // But some examples use: info=playrecording
        // Let's try the documented version first
        const onecomUrl = `https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=${onecomApiKey}&reqtype=INFO&info=recording&id=${callId}&tenant=${onecomTenant}`;
        const onecomUrlPlay = `https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=${onecomApiKey}&reqtype=INFO&info=playrecording&id=${callId}&tenant=${onecomTenant}`;
    
    console.log('🎵 Constructed 1com URL (recording):', onecomUrl.replace(onecomApiKey, '***'));
    console.log('🎵 Constructed 1com URL (playrecording):', onecomUrlPlay.replace(onecomApiKey, '***'));
    
    // Make request to 1com API - try both parameters
    console.log('🎵 Making request to 1com API with info=recording...');
    let response = await fetch(onecomUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Leadify-CRM/1.0',
        'Accept': 'audio/*,*/*'
      }
    });
    
    console.log('🎵 1com API response status (recording):', response.status);
    console.log('🎵 1com API response headers (recording):', Object.fromEntries(response.headers.entries()));
    
    // If the first request returns HTML (error), try the alternative parameter
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('text/html')) {
      console.log('🎵 First request returned HTML, trying info=playrecording...');
      response = await fetch(onecomUrlPlay, {
        method: 'GET',
        headers: {
          'User-Agent': 'Leadify-CRM/1.0',
          'Accept': 'audio/*,*/*'
        }
      });
      console.log('🎵 1com API response status (playrecording):', response.status);
      console.log('🎵 1com API response headers (playrecording):', Object.fromEntries(response.headers.entries()));
    }
    
    if (!response.ok) {
      console.error('🎵 Recording request failed:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('🎵 Error response:', errorText);
      return res.status(response.status).json({ error: 'Recording not available' });
    }
    
        // Get content type (already retrieved above)
        const finalContentType = response.headers.get('content-type') || 'audio/mpeg';
        console.log('🎵 Final content type:', finalContentType);
        
        // Get the response data as buffer
        const responseBuffer = await response.arrayBuffer();
        console.log('🎵 Response size:', responseBuffer.byteLength, 'bytes');
        
        // Check if the response is HTML (error page) instead of audio
        if (finalContentType.includes('text/html')) {
          console.error('🎵 1com API returned HTML instead of audio. This usually means:');
          console.error('🎵 1. The recording does not exist or has been archived');
          console.error('🎵 2. The API key does not have permission to access recordings');
          console.error('🎵 3. The recording ID is invalid or from an older period');
          console.error('🎵 4. The recording might be from 2024 and no longer accessible');
          
          // Try to get the HTML content to see what error message 1com returned
          const htmlContent = Buffer.from(responseBuffer).toString('utf-8');
          console.error('🎵 1com HTML response:', htmlContent.substring(0, 500));
          
          // Check if it's a 2024 recording (pbx24-*)
          const isOldRecording = callId.startsWith('pbx24-');
          
          return res.status(404).json({ 
            error: 'Recording not available',
            details: isOldRecording 
              ? 'This recording appears to be from 2024 and may no longer be accessible. 1com typically archives older recordings.'
              : 'The recording could not be found or accessed. This may be due to insufficient permissions or the recording not existing.',
            contentType: finalContentType,
            isOldRecording: isOldRecording
          });
        }
        
        // Set appropriate headers for audio
        res.set({
          'Content-Type': finalContentType,
          'Content-Length': responseBuffer.byteLength.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600'
        });
        
        // Send the audio data
        res.send(Buffer.from(responseBuffer));
    
  } catch (error) {
    console.error('🎵 Recording proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch recording' });
  }
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

// Log all incoming requests to /api/hook/facebook BEFORE routing
app.use('/api/hook/facebook', (req, res, next) => {
  console.log('='.repeat(100));
  console.log('🔥🔥🔥 INCOMING REQUEST TO /api/hook/facebook 🔥🔥🔥');
  console.log('🔥 Method:', req.method);
  console.log('🔥 Time:', new Date().toISOString());
  console.log('🔥 IP:', req.ip || req.connection.remoteAddress);
  console.log('🔥 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🔥 Body exists:', !!req.body);
  console.log('='.repeat(100));
  next();
});

// API routes
app.use('/api', userRoutes);
app.use('/api/teams', teamsCallingRoutes);
app.use('/api/teams/bot', teamsBotRoutes);
app.use('/api', webhookRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/onecom', onecomRoutes);
app.use('/api', authRoutes);
app.use('/api', emailRoutes);
app.use('/api', syncRoutes);
app.use('/api', pushNotificationRoutes);

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

  // Log webhook configuration status
  const webhookUrl = process.env.GRAPH_WEBHOOK_NOTIFICATION_URL;
  if (webhookUrl) {
    console.log(`✅ Graph webhook URL configured: ${webhookUrl}`);
    console.log(`   Webhook endpoints:`);
    console.log(`   - GET  /api/graph/webhook (validation)`);
    console.log(`   - POST /api/graph/webhook (notifications)`);
    console.log(`   - POST /api/graph/subscriptions/refresh (refresh all subscriptions)`);
    console.log(`   - GET  /api/graph/subscriptions/status (check subscription status)`);
  } else {
    console.warn(`⚠️  GRAPH_WEBHOOK_NOTIFICATION_URL not configured. Webhook subscriptions will not work.`);
    console.warn(`   Set GRAPH_WEBHOOK_NOTIFICATION_URL environment variable to enable webhook notifications.`);
  }

  // Email fetching scheduler enabled - fetches emails every 5 minutes
  startMailboxSyncScheduler();
  startMeetingNotificationScheduler();
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