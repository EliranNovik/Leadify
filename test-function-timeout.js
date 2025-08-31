// Test function with timeout to see if it's hanging
console.log('🔧 Testing function with timeout...');

// Create a promise with timeout
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('Function call timed out after 30 seconds')), 30000);
});

// Function call
const functionPromise = supabase.functions.invoke('meeting-summary', {
  body: {
    meetingId: 'test123',
    clientId: '1',
    transcriptText: 'Test transcript for debugging.',
    autoFetchTranscript: false
  }
});

// Race between function and timeout
Promise.race([functionPromise, timeoutPromise])
.then(response => {
  console.log('✅ Function completed successfully:', response);
})
.catch(error => {
  console.error('❌ Function failed or timed out:', error);
  
  if (error.message.includes('timed out')) {
    console.error('🚨 Function is hanging - this indicates a serious deployment issue');
  } else {
    console.error('🚨 Function error:', error.message);
  }
});

console.log('🔧 Test initiated with 30-second timeout...');
