// Test webhook public access
// Run this in your browser console

const testWebhookPublicAccess = async () => {
  console.log('🔧 Testing webhook public access...\n');
  
  const webhookUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook';
  
  try {
    // Test 1: Direct HTTP request to webhook
    console.log('📋 Test 1: Direct HTTP request to webhook');
    console.log('URL:', webhookUrl);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        validationToken: 'test-public-access-123',
        clientState: 'leadify-crm-webhook-secret'
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Response body:', responseText);
    
    if (response.status === 200 && responseText === 'test-public-access-123') {
      console.log('✅ Webhook is publicly accessible and responding correctly!');
    } else {
      console.log('❌ Webhook is not responding as expected');
    }
    
    // Test 2: Test with Supabase client
    console.log('\n📋 Test 2: Test with Supabase client');
    const supabaseResponse = await supabase.functions.invoke('graph-webhook', {
      body: {
        validationToken: 'test-supabase-client-456',
        clientState: 'leadify-crm-webhook-secret'
      }
    });
    
    console.log('Supabase response:', supabaseResponse);
    
  } catch (error) {
    console.error('❌ Error testing webhook access:', error);
  }
};

// Run the test
testWebhookPublicAccess();
