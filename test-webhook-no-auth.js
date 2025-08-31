// Test webhook without authentication
// Run this in your browser console

console.log('🔧 Testing webhook without authentication...');

const webhookUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook';

// Test with different approaches
console.log('📋 Testing different access methods...');

// Method 1: Simple GET request
fetch(webhookUrl)
.then(response => {
  console.log('✅ GET response status:', response.status);
  return response.text();
})
.then(text => {
  console.log('✅ GET response body:', text);
})
.catch(error => {
  console.error('❌ GET error:', error);
});

// Method 2: POST with minimal headers
fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    validationToken: 'test-no-auth'
  })
})
.then(response => {
  console.log('✅ POST response status:', response.status);
  return response.text();
})
.then(text => {
  console.log('✅ POST response body:', text);
})
.catch(error => {
  console.error('❌ POST error:', error);
});

console.log('🔧 Tests initiated...');
