// Test script to check and activate Graph subscription
// Run this in your browser console

const testGraphSubscription = async () => {
  console.log('🔧 Testing Graph Subscription...\n');
  
  try {
    // Test 1: Check current subscription status
    console.log('📋 Test 1: Checking subscription status');
    const statusResponse = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'status' }
    });
    
    console.log('Status response:', statusResponse);
    
    if (statusResponse.data && statusResponse.data.success) {
      console.log('✅ Subscription is active:', statusResponse.data.subscription);
      console.log('Message:', statusResponse.data.message);
    } else {
      console.log('❌ No active subscription found');
      
      // Test 2: Try to create a new subscription
      console.log('\n📋 Test 2: Creating new subscription');
      const createResponse = await supabase.functions.invoke('graph-subscription-manager', {
        body: { action: 'create' }
      });
      
      console.log('Create response:', createResponse);
      
      if (createResponse.data && createResponse.data.success) {
        console.log('✅ Subscription created successfully!');
        console.log('Subscription ID:', createResponse.data.subscription.id);
        console.log('Expires:', createResponse.data.subscription.expirationDateTime);
      } else {
        console.error('❌ Failed to create subscription:', createResponse.error || createResponse.data?.error);
      }
    }
    
    // Test 3: List all subscriptions
    console.log('\n📋 Test 3: Listing all subscriptions');
    const listResponse = await supabase.functions.invoke('graph-subscription-manager', {
      body: { action: 'list' }
    });
    
    console.log('List response:', listResponse);
    
    if (listResponse.data && listResponse.data.success) {
      console.log('✅ Found subscriptions:', listResponse.data.subscriptions?.length || 0);
      if (listResponse.data.subscriptions) {
        listResponse.data.subscriptions.forEach((sub, index) => {
          console.log(`  ${index + 1}. ${sub.resource} (${sub.changeType}) - Expires: ${sub.expirationDateTime}`);
        });
      }
    } else {
      console.log('❌ No subscriptions found or error:', listResponse.error || listResponse.data?.error);
    }
    
  } catch (error) {
    console.error('❌ Error testing Graph subscription:', error);
  }
};

// Run the test
testGraphSubscription();
