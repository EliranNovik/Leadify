// Test script to manually process the call record we received
console.log('🔧 Testing call record processing...');

// The call record ID from the webhook notification
const callRecordId = 'e47ac2a3-fea1-4680-94c4-2a29fa1fbcca';

console.log(`Testing with call record ID: ${callRecordId}`);

supabase.functions.invoke('meeting-summary', {
  body: {
    callRecordId: callRecordId,
    clientId: '1', // Default client ID
    autoFetchTranscript: true,
    processCallRecord: true
  }
})
.then(response => {
  console.log('✅ Call record processing response:', response);
  
  if (response.data) {
    console.log('📝 Transcript data:', response.data.transcript);
    console.log('📋 Summary data:', response.data.summary);
    console.log('❓ Questionnaire data:', response.data.questionnaire);
  }
})
.catch(error => {
  console.error('❌ Call record processing error:', error);
});

console.log('🔧 Test initiated...');
