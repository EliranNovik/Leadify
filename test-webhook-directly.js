// Test script to check webhook URL directly
// Run this in your browser console

const testWebhookDirectly = async () => {
  console.log('🔧 Testing Webhook URL Directly...\n');
  
  try {
    // Test 1: Test webhook with validation token
    console.log('📋 Test 1: Testing webhook validation');
    const webhookResponse = await supabase.functions.invoke('graph-webhook', {
      body: { 
        validationToken: 'test-validation-token-123',
        clientState: 'leadify-crm-webhook-secret'
      }
    });
    
    console.log('Webhook response:', webhookResponse);
    
    if (webhookResponse.data === 'test-validation-token-123') {
      console.log('✅ Webhook validation working correctly!');
    } else {
      console.log('❌ Webhook validation not working as expected');
      console.log('Expected: test-validation-token-123');
      console.log('Got:', webhookResponse.data);
    }
    
    // Test 2: Test webhook with empty body
    console.log('\n📋 Test 2: Testing webhook with empty body');
    const emptyResponse = await supabase.functions.invoke('graph-webhook', {
      body: {}
    });
    
    console.log('Empty body response:', emptyResponse);
    
    // Test 3: Check the webhook URL
    console.log('\n📋 Test 3: Checking webhook URL');
    const webhookUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook';
    console.log('Expected webhook URL:', webhookUrl);
    console.log('This should match GRAPH_WEBHOOK_URL in your Supabase secrets');
    
  } catch (error) {
    console.error('❌ Error testing webhook:', error);
  }
};

// Run the test
testWebhookDirectly();
