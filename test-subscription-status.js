// Test script to check subscription status
console.log('🔧 Checking current subscription status...');

// Check if supabase is available
if (typeof supabase === 'undefined') {
  console.error('❌ Supabase client not available. Make sure you\'re running this in the browser console.');
} else {
  supabase.functions.invoke('graph-subscription-manager', {
    body: {
      action: 'list'
    }
  })
  .then(response => {
    console.log('✅ Subscription list response:', response);
    
    if (response.data && response.data.length > 0) {
      console.log('🎉 Active subscriptions found!');
      response.data.forEach((sub, index) => {
        console.log(`\n--- Subscription ${index + 1} ---`);
        console.log(`Resource: ${sub.resource}`);
        console.log(`Status: ${sub.status}`);
        console.log(`Expiration: ${sub.expirationDateTime}`);
        console.log(`ID: ${sub.id}`);
        console.log(`ChangeType: ${sub.changeType}`);
      });
    } else {
      console.log('❌ No active subscriptions found');
      console.log('💡 This means no webhooks will be sent when meetings end');
    }
  })
  .catch(error => {
    console.error('❌ Subscription list error:', error);
  });
}

console.log('🔧 Test initiated...');
