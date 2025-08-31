// Test script to debug meeting processing
// Run this in your browser console

const testMeetingProcessing = async () => {
  console.log('🔧 Testing Meeting Processing...\n');
  
  try {
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('❌ User not authenticated:', userError);
      return;
    }
    
    console.log('✅ User authenticated:', user.email);
    
    // Get a test meeting
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('id, client_id, meeting_date, meeting_time')
      .limit(1);
    
    if (meetingsError || !meetings || meetings.length === 0) {
      console.error('❌ No meetings found:', meetingsError);
      return;
    }
    
    const testMeeting = meetings[0];
    console.log('✅ Test meeting found:', testMeeting);
    
    // Test the processing using the Edge Function directly
    console.log('📋 Testing meeting processing...');
    const result = await supabase.functions.invoke('meeting-summary', {
      body: {
        meetingId: testMeeting.id.toString(),
        clientId: testMeeting.client_id,
        userId: user.id,
        autoFetchTranscript: true
      }
    });
    
    console.log('📋 Processing result:', result);
    
    if (result.data && result.data.success) {
      console.log('✅ Meeting processed successfully!');
      console.log('Meeting ID:', result.data.meetingId);
      console.log('Summary ID:', result.data.summaryId);
      console.log('Transcript Source:', result.data.transcriptSource);
    } else {
      console.error('❌ Processing failed:', result.error || result.data?.error);
    }
    
  } catch (error) {
    console.error('❌ Error in test:', error);
  }
};

// Run the test
testMeetingProcessing();
