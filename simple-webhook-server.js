import http from 'http';
import url from 'url';

// Simple webhook server for Microsoft Graph
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  
  // Handle validation token (Graph API sends this to verify the endpoint)
  if (parsedUrl.query.validationToken) {
    console.log('Validation request received:', parsedUrl.query.validationToken);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(parsedUrl.query.validationToken);
    return;
  }
  
  // Handle POST requests (actual notifications)
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        console.log('Webhook notification received:', JSON.stringify(data, null, 2));
        
        // Process the notification here
        if (data.value && data.value.length > 0) {
          console.log(`Processing ${data.value.length} notification(s)`);
          
          data.value.forEach(notification => {
            console.log('Notification:', notification);
            
            // Handle different types of notifications
            if (notification.changeType === 'created') {
              
              // 1. Online meetings
              if (notification.resource.includes('communications/onlineMeetings')) {
                console.log('🟢 Online meeting notification detected!');
                
                const meetingMatch = notification.resource.match(/onlineMeetings\/([^\/]+)/);
                if (meetingMatch) {
                  const meetingId = meetingMatch[1];
                  console.log('Meeting ID:', meetingId);
                  console.log('Would process online meeting:', meetingId);
                }
              }
              
              // 2. Call records (for transcripts)
              else if (notification.resource.includes('communications/callRecords')) {
                console.log('🔵 Call record notification detected!');
                
                const callRecordMatch = notification.resource.match(/callRecords\/([^\/]+)/);
                if (callRecordMatch) {
                  const callRecordId = callRecordMatch[1];
                  console.log('Call Record ID:', callRecordId);
                  
                  // Trigger transcript processing
                  console.log('🚀 Triggering transcript processing for call record:', callRecordId);
                  
                  // Call the meeting-summary function to process this call record
                  fetch('https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/meeting-summary', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10Y2N5ZXZ1b3NxZnJjYW96dHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxODMzMTYsImV4cCI6MjA2NTc1OTMxNn0.4TEf73NGY55RE7yF7gt5_d4R8jeHRsJ9uDMWW7TVy_s'
                    },
                    body: JSON.stringify({
                      callRecordId: callRecordId,
                      clientId: '1', // Default client ID - we'll need to map this properly
                      autoFetchTranscript: true,
                      processCallRecord: true
                    })
                  })
                  .then(response => response.json())
                  .then(data => {
                    console.log('✅ Transcript processing triggered:', data);
                  })
                  .catch(error => {
                    console.error('❌ Error triggering transcript processing:', error);
                  });
                }
              }
              
              // 3. Calendar events
              else if (notification.resource.includes('me/events')) {
                console.log('🟡 Calendar event notification detected!');
                
                const eventMatch = notification.resource.match(/events\/([^\/]+)/);
                if (eventMatch) {
                  const eventId = eventMatch[1];
                  console.log('Event ID:', eventId);
                  console.log('Would process calendar event:', eventId);
                }
              }
              
              // 4. Unknown resource type
              else {
                console.log('❓ Unknown notification resource:', notification.resource);
                console.log('Full notification:', notification);
              }
            }
          });
        }
        
        // Return success response
        res.writeHead(202, { 'Content-Type': 'text/plain' });
        res.end('ok');
        
      } catch (error) {
        console.error('Error processing webhook:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('error');
      }
    });
    
    return;
  }
  
  // Handle GET requests (health check)
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Webhook server is running');
    return;
  }
  
  // Default response
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}`);
  console.log('For public access, use ngrok or similar service');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down webhook server...');
  server.close(() => {
    console.log('Webhook server stopped');
    process.exit(0);
  });
});
