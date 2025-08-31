// Step-by-step debug script for Azure AD configuration
// Run this in your browser console

const debugAzureStepByStep = async () => {
  console.log('🔧 Debugging Azure AD Configuration Step by Step...\n');
  
  try {
    // Step 1: Test basic function access
    console.log('📋 Step 1: Testing basic function access');
    const basicTest = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'list' }
    });
    
    console.log('Basic test result:', basicTest);
    
    if (basicTest.error) {
      console.error('❌ Function access failed:', basicTest.error);
      console.log('\n🔍 This suggests:');
      console.log('   - Environment variables not saved properly');
      console.log('   - Function not deployed correctly');
      console.log('   - Azure AD app permissions missing');
      return;
    }
    
    // Step 2: Test Azure token generation
    console.log('\n📋 Step 2: Testing Azure token generation');
    const tokenTest = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'test-token' }
    });
    
    console.log('Token test result:', tokenTest);
    
    if (tokenTest.error || (tokenTest.data && !tokenTest.data.success)) {
      console.error('❌ Token generation failed:', tokenTest.error || tokenTest.data?.error);
      console.log('\n🔍 This suggests:');
      console.log('   - AZURE_CLIENT_ID is wrong');
      console.log('   - AZURE_CLIENT_SECRET is wrong');
      console.log('   - AZURE_TENANT_ID is wrong');
      console.log('   - Azure AD app permissions missing');
      return;
    }
    
    // Step 3: Test webhook URL
    console.log('\n📋 Step 3: Testing webhook URL');
    const webhookTest = await supabase.functions.invoke('graph-webhook', {
      body: { 
        validationToken: 'test-token',
        clientState: 'leadify-crm-webhook-secret'
      }
    });
    
    console.log('Webhook test result:', webhookTest);
    
    if (webhookTest.error) {
      console.error('❌ Webhook test failed:', webhookTest.error);
      console.log('\n🔍 This suggests:');
      console.log('   - GRAPH_WEBHOOK_URL is wrong');
      console.log('   - Webhook function not deployed');
      return;
    }
    
    console.log('✅ All basic tests passed!');
    
  } catch (error) {
    console.error('❌ Error in debug:', error);
  }
};

// Run the debug
debugAzureStepByStep();
