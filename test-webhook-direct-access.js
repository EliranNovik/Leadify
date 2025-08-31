// Test direct webhook access without authentication
// Run this in your browser console

console.log('🔧 Testing direct webhook access...');

const webhookUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook';

// Test 1: Direct GET request (should work)
console.log('📋 Test 1: Direct GET request');
fetch(webhookUrl)
.then(response => {
  console.log('✅ GET response status:', response.status);
  console.log('✅ GET response headers:', Object.fromEntries(response.headers.entries()));
  return response.text();
})
.then(text => {
  console.log('✅ GET response body:', text);
})
.catch(error => {
  console.error('❌ GET error:', error);
});

// Test 2: OPTIONS request (CORS preflight)
console.log('📋 Test 2: OPTIONS request (CORS preflight)');
fetch(webhookUrl, {
  method: 'OPTIONS',
  headers: {
    'Origin': 'https://graph.microsoft.com',
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type'
  }
})
.then(response => {
  console.log('✅ OPTIONS response status:', response.status);
  console.log('✅ OPTIONS response headers:', Object.fromEntries(response.headers.entries()));
  return response.text();
})
.then(text => {
  console.log('✅ OPTIONS response body:', text);
})
.catch(error => {
  console.error('❌ OPTIONS error:', error);
});

// Test 3: POST with validation token (exactly what Graph sends)
console.log('📋 Test 3: POST with validation token');
fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Microsoft Graph'
  },
  body: JSON.stringify({
    validationToken: 'test-validation-token-12345',
    clientState: 'leadify-crm-webhook-secret'
  })
})
.then(response => {
  console.log('✅ POST response status:', response.status);
  console.log('✅ POST response headers:', Object.fromEntries(response.headers.entries()));
  return response.text();
})
.then(text => {
  console.log('✅ POST response body:', text);
})
.catch(error => {
  console.error('❌ POST error:', error);
});

console.log('🔧 All tests initiated...');
