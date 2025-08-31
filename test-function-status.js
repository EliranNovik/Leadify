// Test function status and get detailed error information
console.log('🔧 Testing function status...');

// Test 1: Simple function call with minimal data
supabase.functions.invoke('meeting-summary', {
  body: {
    meetingId: 'test123',
    clientId: '1',
    transcriptText: 'Test transcript for debugging.',
    autoFetchTranscript: false
  }
})
.then(response => {
  console.log('✅ Function response:', response);
  
  if (response.error) {
    console.error('❌ Function returned error:', response.error);
  }
  
  if (response.data) {
    console.log('📝 Function data:', response.data);
  }
})
.catch(error => {
  console.error('❌ Function call failed completely:', error);
  console.error('Error name:', error.name);
  console.error('Error message:', error.message);
  console.error('Error stack:', error.stack);
  
  // Try to get more details
  if (error.context) {
    console.error('Error context:', error.context);
  }
});

console.log('🔧 Test initiated...');
