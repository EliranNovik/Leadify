// Test script to manually fetch transcripts for recent meetings
console.log('🔧 Testing manual transcript fetch...');

// Test with a specific meeting ID (you'll need to replace this with a real meeting ID)
const testMeetingId = '123'; // Replace with actual meeting ID from your database
const testClientId = '1'; // Replace with actual client ID

console.log(`Testing with meeting ID: ${testMeetingId}, client ID: ${testClientId}`);

supabase.functions.invoke('meeting-summary', {
  body: {
    meetingId: testMeetingId,
    clientId: testClientId,
    autoFetchTranscript: true
  }
})
.then(response => {
  console.log('✅ Manual transcript fetch response:', response);
  
  if (response.data) {
    console.log('📝 Transcript data:', response.data.transcript);
    console.log('📋 Summary data:', response.data.summary);
    console.log('❓ Questionnaire data:', response.data.questionnaire);
  }
})
.catch(error => {
  console.error('❌ Manual transcript fetch error:', error);
});

console.log('🔧 Test initiated...');
