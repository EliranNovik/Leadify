// Simple debug test
// Run this in your browser console

console.log('🔧 Starting simple debug test...');

// Test 1: Basic webhook test
console.log('📋 Test 1: Basic webhook test');
supabase.functions.invoke('graph-webhook', {
  body: { 
    validationToken: 'test-123',
    clientState: 'leadify-crm-webhook-secret'
  }
}).then(response => {
  console.log('✅ Webhook response:', response);
}).catch(error => {
  console.error('❌ Webhook error:', error);
});

// Test 2: Basic subscription manager test
console.log('📋 Test 2: Basic subscription manager test');
supabase.functions.invoke('graph-subscription-manager', {
  body: { action: 'test-token' }
}).then(response => {
  console.log('✅ Subscription manager response:', response);
}).catch(error => {
  console.error('❌ Subscription manager error:', error);
});

console.log('🔧 Tests initiated, check console for results...');
