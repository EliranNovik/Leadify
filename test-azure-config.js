// Test script to check Azure configuration
// Run this in your browser console

const testAzureConfig = async () => {
  console.log('🔧 Testing Azure Configuration...\n');
  
  try {
    // Test 1: Check if we can access the subscription manager at all
    console.log('📋 Test 1: Basic subscription manager access');
    const basicResponse = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'list' }
    });
    
    console.log('Basic response:', basicResponse);
    
    if (basicResponse.error) {
      console.error('❌ Function error:', basicResponse.error);
      
      // Test 2: Try a different action to see if it's a specific issue
      console.log('\n📋 Test 2: Trying status action');
      const statusResponse = await supabase.functions.invoke('graph-subscription-manager', {
        body: { action: 'status' }
      });
      
      console.log('Status response:', statusResponse);
      
      if (statusResponse.error) {
        console.error('❌ Status also failed:', statusResponse.error);
        console.log('\n🔍 This suggests missing Azure AD configuration:');
        console.log('   - AZURE_CLIENT_ID');
        console.log('   - AZURE_CLIENT_SECRET');
        console.log('   - AZURE_TENANT_ID');
        console.log('   - GRAPH_WEBHOOK_URL');
      }
    } else {
      console.log('✅ Function is accessible');
    }
    
  } catch (error) {
    console.error('❌ Error testing Azure config:', error);
  }
};

// Run the test
testAzureConfig();
