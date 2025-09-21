# WebSocket Setup for RMQ Messages

## Overview

The RMQ Messages feature now includes real-time messaging with WebSocket support and typing indicators. To enable full functionality, you'll need to set up a WebSocket server.

## Features Implemented

### ✅ Full-Screen Modal

- RMQ Messages now opens as a full-screen modal instead of a separate page
- Accessible via header buttons and quick actions dropdown
- Clean, modern WhatsApp-like interface

### ✅ WebSocket Real-Time Messaging

- Real-time message delivery
- Automatic conversation updates
- Connection status indicators
- Auto-reconnection with exponential backoff

### ✅ Typing Indicators

- Shows when other users are typing
- Animated typing dots (like WhatsApp)
- Multiple users typing support
- Auto-timeout for typing indicators

## WebSocket Server Setup

### Option 1: Simple Node.js Server

Create a new file `websocket-server.js`:

```javascript
const { Server } = require("socket.io");
const http = require("http");

const server = http.createServer();
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Your frontend URL
    methods: ["GET", "POST"],
  },
});

// Store active connections
const activeUsers = new Map();
const typingUsers = new Map();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins with their ID
  socket.on("join", (userId) => {
    activeUsers.set(socket.id, userId);
    socket.userId = userId;
    console.log(`User ${userId} joined`);
  });

  // Join conversation room
  socket.on("join_conversation", (conversationId) => {
    socket.join(`conversation_${conversationId}`);
    console.log(`User joined conversation ${conversationId}`);
  });

  // Leave conversation room
  socket.on("leave_conversation", (conversationId) => {
    socket.leave(`conversation_${conversationId}`);
    console.log(`User left conversation ${conversationId}`);
  });

  // Send message
  socket.on("send_message", (data) => {
    const { conversation_id, content, message_type } = data;
    const userId = activeUsers.get(socket.id);

    if (userId) {
      // Broadcast to conversation room
      socket.to(`conversation_${conversation_id}`).emit("new_message", {
        id: Date.now(), // Temporary ID
        conversation_id,
        sender_id: userId,
        content,
        message_type: message_type || "text",
        sent_at: new Date().toISOString(),
        sender: {
          ids: userId,
          full_name: `User ${userId}`, // You can fetch real user data
        },
      });
    }
  });

  // Typing indicators
  socket.on("start_typing", (data) => {
    const { conversation_id, user_id, user_name } = data;
    typingUsers.set(user_id, {
      conversation_id,
      user_name,
      timestamp: Date.now(),
    });

    socket.to(`conversation_${conversation_id}`).emit("user_typing", {
      conversation_id,
      user_id,
      user_name,
      is_typing: true,
    });
  });

  socket.on("stop_typing", (data) => {
    const { conversation_id, user_id, user_name } = data;
    typingUsers.delete(user_id);

    socket.to(`conversation_${conversation_id}`).emit("user_stopped_typing", {
      conversation_id,
      user_id,
      user_name,
      is_typing: false,
    });
  });

  // Mark as read
  socket.on("mark_as_read", (data) => {
    const { conversation_id, user_id } = data;
    // Handle marking messages as read
    console.log(
      `User ${user_id} marked conversation ${conversation_id} as read`
    );
  });

  socket.on("disconnect", () => {
    const userId = activeUsers.get(socket.id);
    if (userId) {
      activeUsers.delete(socket.id);
      typingUsers.delete(userId);
      console.log(`User ${userId} disconnected`);
    }
  });
});

// Clean up old typing indicators every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of typingUsers.entries()) {
    if (now - data.timestamp > 10000) {
      // 10 seconds timeout
      typingUsers.delete(userId);
    }
  }
}, 30000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
```

### Option 2: Using Existing Backend

If you have an existing Node.js backend, add Socket.IO to it:

```bash
npm install socket.io
```

Then integrate the WebSocket handlers into your existing server.

## Environment Variables

Add to your `.env` file:

```env
VITE_WEBSOCKET_URL=ws://localhost:3001
```

For production:

```env
VITE_WEBSOCKET_URL=wss://your-domain.com
```

## Running the WebSocket Server

1. Install dependencies:

```bash
npm install socket.io
```

2. Run the server:

```bash
node websocket-server.js
```

3. Start your frontend:

```bash
npm run dev
```

## Features in Action

### Real-Time Messaging

- Messages appear instantly for all participants
- No page refresh needed
- Conversation previews update automatically

### Typing Indicators

- See when someone is typing
- Multiple users typing support
- Auto-timeout after 1 second of inactivity
- Animated dots for visual feedback

### Connection Management

- Auto-reconnection on connection loss
- Connection status notifications
- Graceful handling of network issues

## Testing

1. Open the messaging modal from the header
2. Start a conversation with another user
3. Type a message - you should see typing indicators
4. Messages should appear in real-time

## Production Considerations

1. **Authentication**: Implement proper user authentication for WebSocket connections
2. **Rate Limiting**: Add rate limiting for message sending
3. **Message Persistence**: Ensure messages are saved to your database
4. **Scaling**: Consider using Redis for multi-server setups
5. **Security**: Implement proper CORS and authentication

## Troubleshooting

- **Connection Issues**: Check the WebSocket URL in environment variables
- **Messages Not Appearing**: Verify the WebSocket server is running
- **Typing Indicators Not Working**: Check browser console for WebSocket errors
- **Port Conflicts**: Change the WebSocket server port if needed

The messaging system is now fully functional with real-time capabilities and typing indicators!
