# Teams Calling Functionality

## Overview

The Teams page now includes full calling capabilities that allow users to initiate audio and video calls with their colleagues through Microsoft Teams.

## Features Implemented

### 📞 **Calling Capabilities**

- **Audio Calls**: Initiate voice-only calls
- **Video Calls**: Initiate video calls with camera and microphone
- **Call Controls**: Mute/unmute, end call functionality
- **Call Status**: Visual indicators showing active calls
- **Real-time Updates**: Call state management and status updates

### 🎯 **User Interface**

- **Mobile View**: WhatsApp-style interface with calling buttons in chat header
- **Desktop View**: Traditional layout with calling controls in chat header
- **Call Status Bar**: Shows when a call is active with participant name and mute status
- **Loading States**: Spinner indicators during call initiation

### 🔧 **Technical Implementation**

#### **Microsoft Graph API Integration**

- Uses Microsoft Graph Communications API
- Requires additional scopes: `Calls.InitiateOutgoingCall`, `Calls.JoinGroupCall.All`, `Calls.AccessMedia.All`, `Calls.InitiateGroupCall.All`
- Handles authentication through MSAL

#### **Key Functions**

```typescript
// Initiate a call
initiateTeamsCall(accessToken, targetUserId, callType);

// End an active call
endCall(accessToken, callId);

// Toggle mute status
muteCall(accessToken, callId, isMuted);

// Get call status
getCallStatus(accessToken, callId);
```

## How to Use

### **Initiating Calls**

1. Select a contact from the Teams contact list
2. Click the phone icon (📞) for audio call or video icon (📹) for video call
3. The call will be initiated through Microsoft Teams
4. A loading spinner will show during call setup

### **During Active Calls**

- **Mute/Unmute**: Click the microphone icon to toggle mute
- **End Call**: Click the red X button to end the call
- **Call Status**: A status bar shows the call is active with participant name

### **Mobile Experience**

- Full-screen contact list (WhatsApp-style)
- Tap contact to open chat
- Call buttons in chat header
- Back button to return to contact list

### **Desktop Experience**

- Sidebar with contacts + main chat area
- Call controls in chat header
- Traditional Teams-like layout

## Requirements

### **Microsoft Graph Permissions**

The following scopes must be configured in your Azure AD app:

- `Calls.InitiateOutgoingCall`
- `Calls.JoinGroupCall.All`
- `Calls.AccessMedia.All`
- `Calls.InitiateGroupCall.All`

### **Browser Requirements**

- Modern browser with WebRTC support
- Microphone and camera permissions (for video calls)
- HTTPS connection (required for media access)

## Error Handling

The implementation includes comprehensive error handling:

- **Authentication Errors**: Automatic token refresh
- **Network Errors**: User-friendly error messages
- **Permission Errors**: Clear guidance for microphone/camera access
- **Call Failures**: Graceful fallback with toast notifications

## Security Considerations

- All calls go through Microsoft Teams infrastructure
- No direct peer-to-peer connections
- Calls are logged and monitored by Microsoft
- Authentication handled through MSAL
- No call data stored locally

## Future Enhancements

Potential improvements that could be added:

- **Call History**: Track and display call logs
- **Call Recording**: Integration with Teams recording features
- **Screen Sharing**: Add screen sharing capabilities
- **Call Transfers**: Transfer calls between participants
- **Call Quality**: Monitor and display call quality metrics

## Troubleshooting

### **Common Issues**

1. **"Failed to initiate call"**

   - Check Microsoft Graph permissions
   - Verify user has Teams license
   - Ensure target user is available

2. **"No microphone access"**

   - Grant browser microphone permissions
   - Check system microphone settings
   - Try refreshing the page

3. **"Call not connecting"**
   - Check internet connection
   - Verify Teams service status
   - Try audio-only call first

### **Debug Information**

- Check browser console for detailed error messages
- Verify MSAL token acquisition
- Monitor network requests in browser dev tools

## API Reference

### **Graph API Endpoints Used**

- `POST /communications/calls` - Initiate call
- `DELETE /communications/calls/{id}` - End call
- `POST /communications/calls/{id}/updateRecordingStatus` - Mute/unmute
- `GET /communications/calls/{id}` - Get call status

### **Required Headers**

```javascript
{
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

This implementation provides a complete Teams calling experience integrated seamlessly into the existing Teams chat interface.
