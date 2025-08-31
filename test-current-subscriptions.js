// Test script to check and recreate subscriptions
console.log('🔧 Checking current subscription status...');

// Check current subscriptions
supabase.functions.invoke('graph-subscription-manager', {
  body: {
    action: 'list'
  }
})
.then(response => {
  console.log('✅ Current subscriptions:', response);
  
  if (response.data && response.data.length > 0) {
    console.log('🎉 Active subscriptions found!');
    response.data.forEach((sub, index) => {
      console.log(`\n--- Subscription ${index + 1} ---`);
      console.log(`Resource: ${sub.resource}`);
      console.log(`Status: ${sub.status}`);
      console.log(`Expiration: ${sub.expirationDateTime}`);
      console.log(`ID: ${sub.id}`);
      
      // Check if subscription is expired
      const expirationDate = new Date(sub.expirationDateTime);
      const now = new Date();
      if (expirationDate < now) {
        console.log('❌ This subscription has EXPIRED!');
      } else {
        console.log('✅ Subscription is still active');
      }
    });
  } else {
    console.log('❌ No active subscriptions found');
    console.log('🔄 Recreating subscriptions...');
    
    // Recreate subscriptions
    return supabase.functions.invoke('graph-subscription-manager', {
      body: {
        action: 'create'
      }
    });
  }
})
.then(response => {
  if (response) {
    console.log('✅ Subscription recreation response:', response);
  }
})
.catch(error => {
  console.error('❌ Error:', error);
});

console.log('🔧 Test initiated...');
