// Debug script to check frontend URL generation
console.log('🔧 Testing frontend URL generation...');

// Simulate the API configuration
const getApiBaseUrl = () => {
  // Simulate production environment
  const isDev = false; // Force production mode for testing
  
  console.log('🔧 Environment detection:', {
    DEV: isDev,
    MODE: 'production',
    PROD: true
  });
  
  if (isDev) {
    console.log('🔧 Using development mode (relative URLs)');
    return '';
  }
  
  console.log('🔧 Using production mode (full backend URL)');
  return 'https://leadify-crm-backend.onrender.com';
};

const apiBaseUrl = getApiBaseUrl();

const buildApiUrl = (endpoint) => {
  const fullUrl = `${apiBaseUrl}${endpoint}`;
  console.log('🔗 Building API URL:', { endpoint, apiBaseUrl, fullUrl });
  return fullUrl;
};

// Test the specific media URL from your logs
const mediaId = '1418538702773809';
const mediaUrl = buildApiUrl(`/api/whatsapp/media/${mediaId}`);

console.log('\n📋 Test Results:');
console.log('Media ID:', mediaId);
console.log('Generated URL:', mediaUrl);
console.log('Expected URL:', 'https://leadify-crm-backend.onrender.com/api/whatsapp/media/1418538702773809');
console.log('URLs match:', mediaUrl === 'https://leadify-crm-backend.onrender.com/api/whatsapp/media/1418538702773809');

// Test if the URL is accessible
console.log('\n🧪 Testing URL accessibility...');
fetch(mediaUrl)
  .then(response => {
    console.log('✅ URL is accessible');
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    console.log('Content-Length:', response.headers.get('content-length'));
  })
  .catch(error => {
    console.log('❌ URL is not accessible:', error.message);
  });
