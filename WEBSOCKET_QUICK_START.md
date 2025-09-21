# Quick WebSocket Setup

## The Issue

You're seeing WebSocket connection errors because there's no WebSocket server running. The messaging system works fine without WebSocket, but you won't get real-time features like:

- Instant message delivery
- Typing indicators
- Live conversation updates

## Quick Fix

### Option 1: Start WebSocket Server (Recommended)

```bash
# In a new terminal window, run:
npm run websocket
```

You should see:

```
WebSocket server running on port 3001
Frontend should connect to: ws://localhost:3001
```

Then refresh your browser and open the messaging modal. You should see:

```
🔌 WebSocket connected: [connection-id]
✅ Connected to live messaging
```

### Option 2: Use Without WebSocket

The messaging system works perfectly fine without WebSocket! You just won't get:

- Real-time message delivery (messages will appear after a page refresh)
- Typing indicators
- Live updates

Everything else works normally.

## Troubleshooting

### WebSocket Server Won't Start

```bash
# Check if port 3001 is in use
lsof -i :3001

# Kill any process using the port
kill -9 [PID]

# Try starting again
npm run websocket
```

### Still Getting Connection Errors

The system is designed to work without WebSocket. The errors are just informational. You can:

1. **Ignore the errors** - messaging works fine
2. **Start the WebSocket server** - get real-time features
3. **Disable WebSocket entirely** by commenting out the WebSocket initialization in `RMQMessagesPage.tsx`

## Features Comparison

| Feature           | Without WebSocket         | With WebSocket     |
| ----------------- | ------------------------- | ------------------ |
| Send Messages     | ✅ Works                  | ✅ Works           |
| Receive Messages  | ✅ Works (refresh needed) | ✅ Works (instant) |
| Typing Indicators | ❌ Not available          | ✅ Works           |
| Real-time Updates | ❌ Not available          | ✅ Works           |
| Conversation List | ✅ Works                  | ✅ Works           |
| Full-Screen Modal | ✅ Works                  | ✅ Works           |

## Production Setup

For production, you'll want to:

1. Deploy the WebSocket server to a cloud service
2. Update the `VITE_WEBSOCKET_URL` environment variable
3. Use SSL (wss://) for secure connections

The current setup is perfect for development and testing!
