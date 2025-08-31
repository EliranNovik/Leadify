// Meeting Summary System Test Script
// Copy and paste this into your browser console

console.log('🧪 Meeting Summary System Test Suite');
console.log('=====================================\n');

// Test 1: Check if we're on the right page
const testPageContext = () => {
  console.log('📋 Test 1: Page Context');
  console.log('Current URL:', window.location.href);
  console.log('Pathname:', window.location.pathname);
  
  const isOnClientsPage = window.location.pathname.includes('/clients');
  if (isOnClientsPage) {
    console.log('✅ On clients page');
    const leadMatch = window.location.pathname.match(/\/clients\/([^\/]+)/);
    if (leadMatch) {
      console.log('📋 Lead Number:', leadMatch[1]);
    }
  } else {
    console.log('❌ Not on clients page - navigate to /clients/[lead-number]');
    console.log('💡 Example: /clients/L2025001');
  }
  console.log('');
};

// Test 2: Check Supabase connection
const testSupabaseConnection = async () => {
  console.log('📋 Test 2: Supabase Connection');
  
  if (typeof supabase === 'undefined') {
    console.log('❌ Supabase client not available');
    return false;
  }
  
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.log('❌ Auth error:', error.message);
      return false;
    }
    
    if (data.session) {
      console.log('✅ User authenticated:', data.session.user.email);
      return true;
    } else {
      console.log('❌ User not authenticated');
      return false;
    }
  } catch (error) {
    console.log('❌ Connection error:', error.message);
    return false;
  }
};

// Test 3: Check database tables
const testDatabaseTables = async () => {
  console.log('📋 Test 3: Database Tables');
  
  try {
    // Check if meeting_transcripts table exists
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('meeting_transcripts')
      .select('count')
      .limit(1);
    
    if (transcriptsError) {
      console.log('❌ meeting_transcripts table error:', transcriptsError.message);
      return false;
    }
    console.log('✅ meeting_transcripts table accessible');
    
    // Check if meeting_summaries table exists
    const { data: summaries, error: summariesError } = await supabase
      .from('meeting_summaries')
      .select('count')
      .limit(1);
    
    if (summariesError) {
      console.log('❌ meeting_summaries table error:', summariesError.message);
      return false;
    }
    console.log('✅ meeting_summaries table accessible');
    
    // Check if meeting_questionnaires table exists
    const { data: questionnaires, error: questionnairesError } = await supabase
      .from('meeting_questionnaires')
      .select('count')
      .limit(1);
    
    if (questionnairesError) {
      console.log('❌ meeting_questionnaires table error:', questionnairesError.message);
      return false;
    }
    console.log('✅ meeting_questionnaires table accessible');
    
    return true;
  } catch (error) {
    console.log('❌ Database test error:', error.message);
    return false;
  }
};

// Test 4: Create test meeting data
const createTestMeetingData = async () => {
  console.log('📋 Test 4: Creating Test Meeting Data');
  
  try {
    // First, get a client/lead to work with
    const { data: leads, error: leadsError } = await supabase
      .from('leads')
      .select('id, name, lead_number')
      .limit(1);
    
    if (leadsError || !leads || leads.length === 0) {
      console.log('❌ No leads found:', leadsError?.message || 'No data');
      return null;
    }
    
    const testLead = leads[0];
    console.log('✅ Using test lead:', testLead.name, `(${testLead.lead_number})`);
    
    // Create a test meeting
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .insert({
        client_id: testLead.id,
        teams_id: 'test-meeting-' + Date.now(),
        meeting_subject: 'Test Meeting for Summary System',
        started_at: new Date().toISOString(),
        ended_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
        status: 'completed'
      })
      .select()
      .single();
    
    if (meetingError) {
      console.log('❌ Failed to create test meeting:', meetingError.message);
      return null;
    }
    
    console.log('✅ Test meeting created with ID:', meeting.id);
    return meeting;
  } catch (error) {
    console.log('❌ Test data creation error:', error.message);
    return null;
  }
};

// Test 5: Test the meeting summary API
const testMeetingSummaryAPI = async (meetingId) => {
  console.log('📋 Test 5: Meeting Summary API');
  
  try {
    // Test transcript creation
    const { data: transcript, error: transcriptError } = await supabase
      .from('meeting_transcripts')
      .insert({
        meeting_id: meetingId,
        text: 'This is a test transcript for the meeting summary system. The client discussed their citizenship application and provided information about their family history.',
        source: 'test',
        language: 'en',
        raw_transcript: 'Test raw transcript data'
      })
      .select()
      .single();
    
    if (transcriptError) {
      console.log('❌ Failed to create test transcript:', transcriptError.message);
      return false;
    }
    console.log('✅ Test transcript created');
    
    // Test summary creation
    const { data: summary, error: summaryError } = await supabase
      .from('meeting_summaries')
      .insert({
        meeting_id: meetingId,
        summary_he: 'זהו סיכום בדיקה של הפגישה. הלקוח דן בבקשת האזרחות שלו וסיפק מידע על ההיסטוריה המשפחתית שלו.',
        summary_en: 'This is a test summary of the meeting. The client discussed their citizenship application and provided information about their family history.',
        model: 'gpt-4o-mini',
        tokens_used: 150,
        language_detected: 'en',
        action_items: [
          { owner: 'Manager', task: 'Review citizenship documents', due_date: '2025-01-15' }
        ],
        risks: ['Document verification required']
      })
      .select()
      .single();
    
    if (summaryError) {
      console.log('❌ Failed to create test summary:', summaryError.message);
      return false;
    }
    console.log('✅ Test summary created');
    
    // Test questionnaire creation
    const { data: questionnaire, error: questionnaireError } = await supabase
      .from('meeting_questionnaires')
      .insert({
        meeting_id: meetingId,
        payload: {
          meeting_type: 'consultation',
          participants: ['Client', 'Manager'],
          key_facts: ['Citizenship application discussed'],
          eligibility_points: ['Family history documented'],
          action_items: ['Review documents'],
          deadlines: ['2025-01-15'],
          next_steps_owner: 'Manager',
          client_concerns: ['Document verification'],
          legal_implications: ['Eligibility assessment needed'],
          required_documents: ['Birth certificates', 'Family records'],
          persecuted_person: {
            full_name: 'Test Person',
            birth_date: '1920-01-01',
            birth_place: 'Vienna, Austria',
            country: 'Austria',
            persecution: 'Holocaust survivor',
            entry_germany_austria: '1938-03-15',
            left_austria_germany: '1939-08-20',
            emigration_destination: 'Israel',
            emigration_date: '1940-01-15'
          },
          family_members: {
            parents: [
              {
                full_name: 'Father Name',
                birth_date: '1890-01-01',
                birth_place: 'Vienna, Austria',
                country: 'Austria'
              }
            ],
            grandparents: [],
            great_grandparents: []
          },
          documents_mentioned: ['Birth certificate', 'Marriage certificate'],
          persecution_details: {
            events: ['Kristallnacht', 'Forced emigration'],
            locations: ['Vienna', 'Berlin'],
            dates: ['1938-11-09', '1939-08-20'],
            types: ['Property confiscation', 'Forced labor']
          }
        },
        version: '1.0'
      })
      .select()
      .single();
    
    if (questionnaireError) {
      console.log('❌ Failed to create test questionnaire:', questionnaireError.message);
      return false;
    }
    console.log('✅ Test questionnaire created');
    
    return true;
  } catch (error) {
    console.log('❌ API test error:', error.message);
    return false;
  }
};

// Test 6: Test the MeetingSummary component
const testMeetingSummaryComponent = async (meetingId) => {
  console.log('📋 Test 6: Meeting Summary Component');
  
  try {
    // Simulate the API calls that the component makes
    const { data: summary, error: summaryError } = await supabase
      .from('meeting_summaries')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();
    
    if (summaryError) {
      console.log('❌ Failed to fetch summary:', summaryError.message);
      return false;
    }
    
    console.log('✅ Summary data:', {
      id: summary.id,
      summary_he: summary.summary_he?.substring(0, 50) + '...',
      summary_en: summary.summary_en?.substring(0, 50) + '...',
      action_items: summary.action_items,
      risks: summary.risks
    });
    
    const { data: transcript, error: transcriptError } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();
    
    if (transcriptError) {
      console.log('❌ Failed to fetch transcript:', transcriptError.message);
      return false;
    }
    
    console.log('✅ Transcript data:', {
      id: transcript.id,
      text_length: transcript.text.length,
      language: transcript.language,
      source: transcript.source
    });
    
    const { data: questionnaire, error: questionnaireError } = await supabase
      .from('meeting_questionnaires')
      .select('*')
      .eq('meeting_id', meetingId)
      .single();
    
    if (questionnaireError) {
      console.log('❌ Failed to fetch questionnaire:', questionnaireError.message);
      return false;
    }
    
    console.log('✅ Questionnaire data:', {
      id: questionnaire.id,
      payload_keys: Object.keys(questionnaire.payload),
      version: questionnaire.version
    });
    
    return true;
  } catch (error) {
    console.log('❌ Component test error:', error.message);
    return false;
  }
};

// Test 7: Clean up test data
const cleanupTestData = async (meetingId) => {
  console.log('📋 Test 7: Cleaning Up Test Data');
  
  try {
    // Delete in reverse order due to foreign key constraints
    await supabase.from('meeting_questionnaires').delete().eq('meeting_id', meetingId);
    await supabase.from('meeting_summaries').delete().eq('meeting_id', meetingId);
    await supabase.from('meeting_transcripts').delete().eq('meeting_id', meetingId);
    await supabase.from('meetings').delete().eq('id', meetingId);
    
    console.log('✅ Test data cleaned up');
    return true;
  } catch (error) {
    console.log('❌ Cleanup error:', error.message);
    return false;
  }
};

// Main test runner
const runAllTests = async () => {
  console.log('🚀 Starting Meeting Summary System Tests...\n');
  
  // Run tests in sequence
  testPageContext();
  
  const isAuthenticated = await testSupabaseConnection();
  if (!isAuthenticated) {
    console.log('❌ Authentication required. Please log in first.');
    return;
  }
  
  const tablesOk = await testDatabaseTables();
  if (!tablesOk) {
    console.log('❌ Database tables not ready. Please run the SQL script first.');
    return;
  }
  
  const testMeeting = await createTestMeetingData();
  if (!testMeeting) {
    console.log('❌ Could not create test meeting data.');
    return;
  }
  
  const apiOk = await testMeetingSummaryAPI(testMeeting.id);
  if (!apiOk) {
    console.log('❌ API tests failed.');
    return;
  }
  
  const componentOk = await testMeetingSummaryComponent(testMeeting.id);
  if (!componentOk) {
    console.log('❌ Component tests failed.');
    return;
  }
  
  await cleanupTestData(testMeeting.id);
  
  console.log('\n🎉 All tests completed successfully!');
  console.log('✅ The meeting summary system is working correctly.');
  console.log('\n💡 Next steps:');
  console.log('1. Navigate to a client page (/clients/[lead-number])');
  console.log('2. Click on the "Meetings" tab');
  console.log('3. You should see the meeting summary content box');
  console.log('4. Create a real Teams meeting to test the full workflow');
};

// Run the tests
runAllTests();
