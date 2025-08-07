// Test script to verify WhatsApp media endpoint
const testMediaEndpoint = async () => {
  const mediaId = '1418538702773809'; // The media ID from your logs
  const baseUrl = 'https://leadify-crm-backend.onrender.com';
  
  console.log('🧪 Testing media endpoint...');
  console.log('🔗 URL:', `${baseUrl}/api/whatsapp/media/${mediaId}`);
  
  try {
    // First test the general API accessibility
    console.log('\n📡 Testing API accessibility...');
    const testResponse = await fetch(`${baseUrl}/api/whatsapp/test`);
    const testData = await testResponse.json();
    console.log('✅ API test response:', testData);
    
    // Now test the media endpoint
    console.log('\n📡 Testing media endpoint...');
    const mediaResponse = await fetch(`${baseUrl}/api/whatsapp/media/${mediaId}`);
    
    console.log('📊 Response status:', mediaResponse.status);
    console.log('📊 Response headers:', Object.fromEntries(mediaResponse.headers.entries()));
    
    if (mediaResponse.ok) {
      console.log('✅ Media endpoint is accessible');
      const contentType = mediaResponse.headers.get('content-type');
      console.log('📄 Content-Type:', contentType);
      
      if (contentType && contentType.startsWith('image/')) {
        console.log('✅ Image content detected');
      } else {
        console.log('⚠️ Unexpected content type:', contentType);
      }
    } else {
      console.log('❌ Media endpoint failed');
      const errorText = await mediaResponse.text();
      console.log('❌ Error response:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

// Run the test
testMediaEndpoint();
