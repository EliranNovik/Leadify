// Test script for Microsoft Graph API integration
// Run this in browser console to test Teams transcript fetching

const testGraphAPIIntegration = async () => {
  console.log('🔗 Testing Microsoft Graph API Integration...');
  
  // Test automatic transcript fetching
  const testAutomaticFetch = async () => {
    console.log('\n📥 Testing Automatic Transcript Fetching...');
    
    const testRequest = {
      meetingId: 'test-teams-meeting-123',
      clientId: 'test-client-456',
      userId: 'test-user-789',
      autoFetchTranscript: true
    };
    
    console.log('Request:', testRequest);
    console.log('\nExpected behavior:');
    console.log('1. Function will attempt to fetch transcript from Teams');
    console.log('2. If transcript found: transcriptSource = "teams"');
    console.log('3. If no transcript: transcriptSource = "none"');
    console.log('4. Meeting details will be fetched from Graph API');
    
    console.log('\n🚀 To test with real API:');
    console.log(`
    // Call the function with Teams integration
    const result = await processMeetingSummaryWithTeamsFetch(
      '${testRequest.meetingId}',
      '${testRequest.clientId}',
      '${testRequest.userId}',
      { autoFetchTranscript: true }
    );
    
    console.log('Result:', result);
    console.log('Transcript source:', result.transcriptSource);
    `);
  };
  
  // Test manual transcript with fallback
  const testManualWithFallback = async () => {
    console.log('\n📝 Testing Manual Transcript with Fallback...');
    
    const testRequest = {
      meetingId: 'test-teams-meeting-456',
      clientId: 'test-client-789',
      userId: 'test-user-123',
      transcriptText: 'This is a fallback transcript if Teams fetch fails.',
      autoFetchTranscript: true
    };
    
    console.log('Request:', testRequest);
    console.log('\nExpected behavior:');
    console.log('1. Function will try to fetch from Teams first');
    console.log('2. If Teams fetch fails, use manual transcript');
    console.log('3. transcriptSource will be "teams" or "manual"');
    
    console.log('\n🚀 To test with real API:');
    console.log(`
    const result = await processMeetingSummaryWithTeamsFetch(
      '${testRequest.meetingId}',
      '${testRequest.clientId}',
      '${testRequest.userId}',
      {
        transcriptText: '${testRequest.transcriptText}',
        autoFetchTranscript: true
      }
    );
    `);
  };
  
  // Test manual transcript only
  const testManualOnly = async () => {
    console.log('\n📄 Testing Manual Transcript Only...');
    
    const testRequest = {
      meetingId: 'test-teams-meeting-789',
      clientId: 'test-client-123',
      userId: 'test-user-456',
      transcriptText: 'This is a manual transcript only.',
      autoFetchTranscript: false
    };
    
    console.log('Request:', testRequest);
    console.log('\nExpected behavior:');
    console.log('1. Function will NOT attempt Teams fetch');
    console.log('2. Use only the provided transcript text');
    console.log('3. transcriptSource will be "manual"');
    
    console.log('\n🚀 To test with real API:');
    console.log(`
    const result = await processMeetingSummaryWithTeamsFetch(
      '${testRequest.meetingId}',
      '${testRequest.clientId}',
      '${testRequest.userId}',
      {
        transcriptText: '${testRequest.transcriptText}',
        autoFetchTranscript: false
      }
    );
    `);
  };
  
  // Test error handling
  const testErrorHandling = async () => {
    console.log('\n⚠️ Testing Error Handling...');
    
    console.log('Common error scenarios:');
    console.log('1. No Microsoft access token available');
    console.log('2. Invalid meeting ID');
    console.log('3. No transcript available in Teams');
    console.log('4. Insufficient permissions');
    console.log('5. Meeting not found');
    
    console.log('\n🚀 To test error scenarios:');
    console.log(`
    // Test with invalid user (no access token)
    try {
      const result = await processMeetingSummaryWithTeamsFetch(
        'valid-meeting-id',
        'valid-client-id',
        'invalid-user-id',
        { autoFetchTranscript: true }
      );
    } catch (error) {
      console.log('Expected error:', error.message);
    }
    
    // Test with invalid meeting ID
    try {
      const result = await processMeetingSummaryWithTeamsFetch(
        'invalid-meeting-id',
        'valid-client-id',
        'valid-user-id',
        { autoFetchTranscript: true }
      );
    } catch (error) {
      console.log('Expected error:', error.message);
    }
    `);
  };
  
  // Run all tests
  await testAutomaticFetch();
  await testManualWithFallback();
  await testManualOnly();
  await testErrorHandling();
  
  console.log('\n✅ Graph API Integration Tests Completed!');
  console.log('\n📋 Next Steps:');
  console.log('1. Set up Azure AD app registration (see MICROSOFT_GRAPH_SETUP.md)');
  console.log('2. Configure environment variables');
  console.log('3. Grant necessary permissions');
  console.log('4. Test with real Teams meeting IDs');
  console.log('5. Verify transcript fetching works');
};

// Test Graph API endpoints
const testGraphAPIEndpoints = async () => {
  console.log('\n🌐 Testing Graph API Endpoints...');
  
  const endpoints = [
    {
      name: 'Get Meeting Details',
      url: 'https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}',
      method: 'GET',
      description: 'Fetch meeting metadata (subject, start/end times)'
    },
    {
      name: 'Get Meeting Artifacts',
      url: 'https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/artifacts',
      method: 'GET',
      description: 'List available artifacts (transcripts, recordings)'
    },
    {
      name: 'Download Transcript',
      url: 'https://graph.microsoft.com/v1.0/communications/callRecords/{meetingId}/artifacts/{artifactId}/content',
      method: 'GET',
      description: 'Download transcript content (VTT format)'
    }
  ];
  
  endpoints.forEach(endpoint => {
    console.log(`\n📡 ${endpoint.name}:`);
    console.log(`   Method: ${endpoint.method}`);
    console.log(`   URL: ${endpoint.url}`);
    console.log(`   Description: ${endpoint.description}`);
  });
  
  console.log('\n🔑 Required Headers:');
  console.log('   Authorization: Bearer {access_token}');
  console.log('   Content-Type: application/json');
};

// Test authentication flows
const testAuthenticationFlows = async () => {
  console.log('\n🔐 Testing Authentication Flows...');
  
  console.log('\n1. Service-to-Service (Client Credentials):');
  console.log('   - Used for automatic transcript fetching');
  console.log('   - Requires application permissions');
  console.log('   - No user interaction required');
  console.log('   - Token obtained via client_id + client_secret');
  
  console.log('\n2. User Delegated:');
  console.log('   - Used for user-specific access');
  console.log('   - Requires user consent');
  console.log('   - User must authenticate first');
  console.log('   - Token obtained via user session');
  
  console.log('\n🚀 Authentication Test:');
  console.log(`
  // Test service-to-service auth
  async function testServiceAuth() {
    const tokenResponse = await fetch('https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'your-client-id',
        client_secret: 'your-client-secret',
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    });
    
    const tokenData = await tokenResponse.json();
    console.log('Access token:', tokenData.access_token);
  }
  `);
};

// Run all tests
const runAllGraphAPITests = () => {
  console.log('🧪 Starting Microsoft Graph API Integration Tests...\n');
  testGraphAPIIntegration();
  testGraphAPIEndpoints();
  testAuthenticationFlows();
};

// Auto-run tests
runAllGraphAPITests();
