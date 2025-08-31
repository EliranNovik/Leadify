// Check database status for meetings and transcripts
console.log('🔧 Checking database status...');

// Check recent meetings
supabase
  .from('meetings')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5)
.then(response => {
  console.log('✅ Recent meetings:', response);
  
  if (response.data && response.data.length > 0) {
    console.log('🎉 Meetings found in database:');
    response.data.forEach((meeting, index) => {
      console.log(`${index + 1}. Meeting ID: ${meeting.id}, Teams ID: ${meeting.teams_id}, Subject: ${meeting.meeting_subject}`);
    });
  } else {
    console.log('❌ No meetings found in database');
  }
})
.catch(error => {
  console.error('❌ Error fetching meetings:', error);
});

// Check recent transcripts
supabase
  .from('meeting_transcripts')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(5)
.then(response => {
  console.log('✅ Recent transcripts:', response);
  
  if (response.data && response.data.length > 0) {
    console.log('🎉 Transcripts found in database:');
    response.data.forEach((transcript, index) => {
      console.log(`${index + 1}. Transcript ID: ${transcript.id}, Meeting ID: ${transcript.meeting_id}, Source: ${transcript.source}`);
    });
  } else {
    console.log('❌ No transcripts found in database');
  }
})
.catch(error => {
  console.error('❌ Error fetching transcripts:', error);
});

console.log('🔧 Database check initiated...');
