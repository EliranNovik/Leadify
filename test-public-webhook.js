// Test the public webhook function
// Run this in your browser console

console.log('🔧 Testing public webhook function...');

const publicWebhookUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook-public';

// Test GET request
fetch(publicWebhookUrl)
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

// Test POST with validation token
fetch(publicWebhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    validationToken: 'test-public-webhook-123',
    clientState: 'leadify-crm-webhook-secret'
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
