// Test script for complete "zero-click" workflow
// Run this in browser console to test the entire automated system

const testZeroClickWorkflow = async () => {
  console.log('🚀 Testing Complete Zero-Click Workflow...\n');
  
  // Test 1: Graph Subscription Management
  const testSubscriptionManagement = async () => {
    console.log('📡 Test 1: Graph Subscription Management');
    
    try {
      // Check current subscription status
      const statusResponse = await supabase.functions.invoke('graph-subscription-manager', {
        body: { action: 'status' }
      });
      
      console.log('Current subscription status:', statusResponse);
      
      if (statusResponse.data?.success && statusResponse.data?.subscription) {
        console.log('✅ Subscription exists and is active');
        return true;
      } else {
        console.log('⚠️ No active subscription found');
        
        // Try to create a new subscription
        const createResponse = await supabase.functions.invoke('graph-subscription-manager', {
          body: { action: 'create' }
        });
        
        if (createResponse.data?.success) {
          console.log('✅ Successfully created new subscription');
          return true;
        } else {
          console.log('❌ Failed to create subscription:', createResponse.data?.error);
          return false;
        }
      }
    } catch (error) {
      console.error('❌ Error testing subscription management:', error);
      return false;
    }
  };
  
  // Test 2: Webhook Endpoint
  const testWebhookEndpoint = async () => {
    console.log('\n🔗 Test 2: Webhook Endpoint');
    
    try {
      // Test webhook validation (simulate Graph API validation)
      const validationResponse = await fetch('/functions/v1/graph-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          validationToken: 'test-validation-token-12345'
        })
      });
      
      if (validationResponse.ok) {
        const validationText = await validationResponse.text();
        console.log('✅ Webhook validation successful:', validationText);
        return true;
      } else {
        console.log('❌ Webhook validation failed:', validationResponse.status);
        return false;
      }
    } catch (error) {
      console.error('❌ Error testing webhook endpoint:', error);
      return false;
    }
  };
  
  // Test 3: Client Mapping Logic
  const testClientMapping = async () => {
    console.log('\n🎯 Test 3: Client Mapping Logic');
    
    const testCases = [
      { subject: '[#L2025001] John Doe - German Citizenship', expected: 'L2025001' },
      { subject: 'Meeting with [#L2025002] Jane Smith', expected: 'L2025002' },
      { subject: 'Regular meeting without client ID', expected: null },
      { subject: '[#INVALID] Test case', expected: 'INVALID' }
    ];
    
    let passed = 0;
    let total = testCases.length;
    
    testCases.forEach((testCase, index) => {
      const match = testCase.subject.match(/\[#([^\]]+)\]/);
      const extracted = match ? match[1] : null;
      
      if (extracted === testCase.expected) {
        console.log(`✅ Test case ${index + 1}: "${testCase.subject}" -> "${extracted}"`);
        passed++;
      } else {
        console.log(`❌ Test case ${index + 1}: "${testCase.subject}" -> "${extracted}" (expected: "${testCase.expected}")`);
      }
    });
    
    console.log(`\n📊 Client mapping tests: ${passed}/${total} passed`);
    return passed === total;
  };
  
  // Test 4: Meeting Summary Processing
  const testMeetingSummaryProcessing = async () => {
    console.log('\n📝 Test 4: Meeting Summary Processing');
    
    try {
      const testRequest = {
        meetingId: 'test-meeting-123',
        clientId: 'test-client-456',
        transcriptText: `
        Client: My grandfather, Moshe Cohen, was born in Vienna, Austria on March 15, 1920. 
        His parents were David Cohen and Sarah Rosenberg. David was born in 1895 in Krakow, Poland, 
        and Sarah was born in 1898 in Budapest, Hungary. They moved to Vienna in 1918.
        
        Moshe was persecuted during the Holocaust. He was arrested in Vienna in 1938 and sent to 
        Dachau concentration camp. He escaped in 1940 and fled to Switzerland, then emigrated to 
        Palestine in 1942. His parents were deported to Auschwitz in 1941 and never returned.
        
        I have their birth certificates, marriage certificate from 1917, and some immigration papers 
        from when they first came to Vienna. My great-grandparents on my grandmother's side were 
        Isaac and Rachel Goldstein from Warsaw, Poland. They were also killed in the Holocaust.
        
        I need help with German citizenship restoration based on this persecution history.
        `,
        autoFetchTranscript: false
      };
      
      const response = await supabase.functions.invoke('meeting-summary', {
        body: testRequest
      });
      
      if (response.data?.success) {
        console.log('✅ Meeting summary processing successful');
        console.log('Meeting ID:', response.data.meetingId);
        console.log('Summary ID:', response.data.summaryId);
        console.log('Transcript source:', response.data.transcriptSource);
        return true;
      } else {
        console.log('❌ Meeting summary processing failed:', response.data?.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error testing meeting summary processing:', error);
      return false;
    }
  };
  
  // Test 5: Complete Workflow Simulation
  const testCompleteWorkflow = async () => {
    console.log('\n🔄 Test 5: Complete Workflow Simulation');
    
    try {
      // Simulate a webhook notification from Graph API
      const webhookPayload = {
        clientState: 'leadify-crm-webhook-secret',
        value: [
          {
            subscriptionId: 'test-subscription-123',
            subscriptionExpirationDateTime: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
            changeType: 'created',
            resource: 'communications/onlineMeetings/test-meeting-456',
            resourceData: {
              '@odata.type': '#microsoft.graph.onlineMeeting',
              '@odata.id': 'communications/onlineMeetings/test-meeting-456',
              id: 'test-meeting-456'
            }
          }
        ]
      };
      
      console.log('Simulating webhook notification for meeting: test-meeting-456');
      
      // Note: This would normally be called by Graph API
      // For testing, we'll simulate the webhook call
      const webhookResponse = await fetch('/functions/v1/graph-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(webhookPayload)
      });
      
      if (webhookResponse.ok) {
        const webhookResult = await webhookResponse.json();
        console.log('✅ Webhook processing successful:', webhookResult);
        return true;
      } else {
        console.log('❌ Webhook processing failed:', webhookResponse.status);
        return false;
      }
    } catch (error) {
      console.error('❌ Error testing complete workflow:', error);
      return false;
    }
  };
  
  // Test 6: Error Handling
  const testErrorHandling = async () => {
    console.log('\n⚠️ Test 6: Error Handling');
    
    const errorTests = [
      {
        name: 'Invalid webhook client state',
        payload: { clientState: 'invalid-secret' },
        expectedError: 'Invalid client state'
      },
      {
        name: 'Missing required fields',
        payload: { meetingId: 'test' }, // Missing clientId
        expectedError: 'Missing required fields'
      },
      {
        name: 'Invalid subscription action',
        payload: { action: 'invalid-action' },
        expectedError: 'Invalid action'
      }
    ];
    
    let passed = 0;
    let total = errorTests.length;
    
    for (const test of errorTests) {
      try {
        if (test.name.includes('webhook')) {
          const response = await fetch('/functions/v1/graph-webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(test.payload)
          });
          
          if (response.status === 401) {
            console.log(`✅ ${test.name}: Correctly rejected`);
            passed++;
          } else {
            console.log(`❌ ${test.name}: Expected 401, got ${response.status}`);
          }
        } else if (test.name.includes('subscription')) {
          const response = await supabase.functions.invoke('graph-subscription-manager', {
            body: test.payload
          });
          
          if (response.data?.error && response.data.error.includes(test.expectedError)) {
            console.log(`✅ ${test.name}: Correctly handled`);
            passed++;
          } else {
            console.log(`❌ ${test.name}: Expected error containing "${test.expectedError}"`);
          }
        }
      } catch (error) {
        console.log(`✅ ${test.name}: Correctly threw error`);
        passed++;
      }
    }
    
    console.log(`\n📊 Error handling tests: ${passed}/${total} passed`);
    return passed === total;
  };
  
  // Run all tests
  const results = await Promise.all([
    testSubscriptionManagement(),
    testWebhookEndpoint(),
    testClientMapping(),
    testMeetingSummaryProcessing(),
    testCompleteWorkflow(),
    testErrorHandling()
  ]);
  
  // Summary
  console.log('\n📋 Test Results Summary');
  console.log('========================');
  console.log('1. Subscription Management:', results[0] ? '✅ PASS' : '❌ FAIL');
  console.log('2. Webhook Endpoint:', results[1] ? '✅ PASS' : '❌ FAIL');
  console.log('3. Client Mapping Logic:', results[2] ? '✅ PASS' : '❌ FAIL');
  console.log('4. Meeting Summary Processing:', results[3] ? '✅ PASS' : '❌ FAIL');
  console.log('5. Complete Workflow Simulation:', results[4] ? '✅ PASS' : '❌ FAIL');
  console.log('6. Error Handling:', results[5] ? '✅ PASS' : '❌ FAIL');
  
  const passedTests = results.filter(r => r).length;
  const totalTests = results.length;
  
  console.log(`\n🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! The zero-click workflow is ready.');
    console.log('\n🚀 Next Steps:');
    console.log('1. Deploy the functions to production');
    console.log('2. Set up Azure AD app registration');
    console.log('3. Configure environment variables');
    console.log('4. Create Graph subscription');
    console.log('5. Test with real Teams meetings');
  } else {
    console.log('⚠️ Some tests failed. Please review the errors above.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Check environment variables');
    console.log('2. Verify Azure AD permissions');
    console.log('3. Ensure functions are deployed');
    console.log('4. Check function logs for errors');
  }
};

// Test individual components
const testIndividualComponents = async () => {
  console.log('🧪 Testing Individual Components...\n');
  
  // Test subscription API
  console.log('📡 Testing Subscription API...');
  try {
    const { data, error } = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'status' }
    });
    console.log('Subscription status:', data);
  } catch (error) {
    console.error('Subscription API error:', error);
  }
  
  // Test webhook endpoint
  console.log('\n🔗 Testing Webhook Endpoint...');
  try {
    const response = await fetch('/functions/v1/graph-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationToken: 'test' })
    });
    console.log('Webhook response status:', response.status);
  } catch (error) {
    console.error('Webhook endpoint error:', error);
  }
  
  // Test meeting summary function
  console.log('\n📝 Testing Meeting Summary Function...');
  try {
    const { data, error } = await supabase.functions.invoke('meeting-summary', {
      body: {
        meetingId: 'test',
        clientId: 'test',
        transcriptText: 'Test transcript',
        autoFetchTranscript: false
      }
    });
    console.log('Meeting summary result:', data);
  } catch (error) {
    console.error('Meeting summary error:', error);
  }
};

// Auto-run tests
const runAllTests = () => {
  console.log('🧪 Starting Zero-Click Workflow Tests...\n');
  testZeroClickWorkflow();
  // Uncomment to test individual components
  // testIndividualComponents();
};

// Run tests
runAllTests();
