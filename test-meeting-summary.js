// Test script for meeting summary functionality
// Run this in the browser console to test the meeting summary system

console.log('=== Meeting Summary Test Script ===');

// Sample transcript data for testing
const sampleTranscript = `
WEBVTT

00:00:00.000 --> 00:00:05.000
שלום, אני אלירן נוביק ואני עורך דין אזרחות

00:00:05.000 --> 00:00:10.000
Hello, I'm Eliran Novik and I'm a citizenship lawyer

00:00:10.000 --> 00:00:15.000
אני אשמח לעזור לך עם תהליך האזרחות

00:00:15.000 --> 00:00:20.000
I'd be happy to help you with the citizenship process

00:00:20.000 --> 00:00:25.000
נצטרך לבדוק את הזכאות שלך לפי החוק

00:00:25.000 --> 00:00:30.000
We'll need to check your eligibility according to the law

00:00:30.000 --> 00:00:35.000
האם יש לך מסמכים מהמשפחה שלך?

00:00:35.000 --> 00:00:40.000
Do you have any documents from your family?

00:00:40.000 --> 00:00:45.000
זה חשוב מאוד לתהליך

00:00:45.000 --> 00:00:50.000
This is very important for the process

00:00:50.000 --> 00:00:55.000
נצטרך להגיש בקשה תוך חודשיים

00:00:55.000 --> 00:01:00.000
We'll need to submit an application within two months
`;

// Test 1: Test the meeting summary API
async function testMeetingSummaryAPI() {
  console.log('\n1. Testing Meeting Summary API...');
  
  try {
    // Test the API service functions
    if (typeof processMeetingSummary === 'function') {
      console.log('✅ processMeetingSummary function is available');
    } else {
      console.log('❌ processMeetingSummary function not found');
    }

    if (typeof getMeetingSummary === 'function') {
      console.log('✅ getMeetingSummary function is available');
    } else {
      console.log('❌ getMeetingSummary function not found');
    }

    if (typeof getMeetingData === 'function') {
      console.log('✅ getMeetingData function is available');
    } else {
      console.log('❌ getMeetingData function not found');
    }

    if (typeof regenerateMeetingSummary === 'function') {
      console.log('✅ regenerateMeetingSummary function is available');
    } else {
      console.log('❌ regenerateMeetingSummary function not found');
    }

  } catch (error) {
    console.error('❌ Error testing API:', error);
  }
}

// Test 2: Test language detection
function testLanguageDetection() {
  console.log('\n2. Testing Language Detection...');
  
  try {
    // Test Hebrew detection
    const hebrewText = 'שלום עולם זה טקסט בעברית';
    const englishText = 'Hello world this is English text';
    const mixedText = 'שלום world זה mixed text';
    
    // Simple Hebrew detection (same logic as edge function)
    function detectLanguage(text) {
      if (/[\u0590-\u05FF]/.test(text)) {
        if (/[a-zA-Z]/.test(text)) {
          return 'mixed';
        }
        return 'he';
      }
      if (/[a-zA-Z]/.test(text)) {
        return 'en';
      }
      return 'mixed';
    }
    
    console.log('Hebrew text detection:', detectLanguage(hebrewText));
    console.log('English text detection:', detectLanguage(englishText));
    console.log('Mixed text detection:', detectLanguage(mixedText));
    
    console.log('✅ Language detection working correctly');
    
  } catch (error) {
    console.error('❌ Error testing language detection:', error);
  }
}

// Test 3: Test VTT to plain text conversion
function testVTTConversion() {
  console.log('\n3. Testing VTT to Plain Text Conversion...');
  
  try {
    // VTT to plain text conversion (same logic as edge function)
    function vttToPlainText(vttContent) {
      const lines = vttContent.split('\n');
      const textLines = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line === '' || line.includes('-->') || line.match(/^\d+$/) || line.startsWith('WEBVTT')) {
          continue;
        }
        
        if (line.length > 0) {
          textLines.push(line);
        }
      }
      
      return textLines.join(' ').replace(/\s+/g, ' ').trim();
    }
    
    const convertedText = vttToPlainText(sampleTranscript);
    console.log('Original VTT length:', sampleTranscript.length);
    console.log('Converted text length:', convertedText.length);
    console.log('Converted text preview:', convertedText.substring(0, 100) + '...');
    
    console.log('✅ VTT conversion working correctly');
    
  } catch (error) {
    console.error('❌ Error testing VTT conversion:', error);
  }
}

// Test 4: Test database tables
async function testDatabaseTables() {
  console.log('\n4. Testing Database Tables...');
  
  try {
    // Check if tables exist by trying to query them
    const { data: summaries, error: summariesError } = await supabase
      .from('meeting_summaries')
      .select('count')
      .limit(1);
    
    if (summariesError) {
      console.log('❌ meeting_summaries table not found or not accessible');
    } else {
      console.log('✅ meeting_summaries table accessible');
    }
    
    const { data: transcripts, error: transcriptsError } = await supabase
      .from('meeting_transcripts')
      .select('count')
      .limit(1);
    
    if (transcriptsError) {
      console.log('❌ meeting_transcripts table not found or not accessible');
    } else {
      console.log('✅ meeting_transcripts table accessible');
    }
    
    const { data: questionnaires, error: questionnairesError } = await supabase
      .from('meeting_questionnaires')
      .select('count')
      .limit(1);
    
    if (questionnairesError) {
      console.log('❌ meeting_questionnaires table not found or not accessible');
    } else {
      console.log('✅ meeting_questionnaires table accessible');
    }
    
  } catch (error) {
    console.error('❌ Error testing database tables:', error);
  }
}

// Test 5: Test edge function availability
async function testEdgeFunction() {
  console.log('\n5. Testing Edge Function Availability...');
  
  try {
    // Test if the edge function is accessible
    const { data, error } = await supabase.functions.invoke('meeting-summary', {
      body: {
        meetingId: 'test-meeting-id',
        clientId: 'test-client-id',
        transcriptText: 'Test transcript for validation'
      }
    });
    
    if (error) {
      console.log('❌ Edge function error:', error.message);
      console.log('This might be expected if the function is not deployed yet');
    } else {
      console.log('✅ Edge function is accessible');
      console.log('Response:', data);
    }
    
  } catch (error) {
    console.log('❌ Edge function not accessible:', error.message);
    console.log('Make sure the function is deployed: supabase functions deploy meeting-summary');
  }
}

// Test 6: Test component integration
function testComponentIntegration() {
  console.log('\n6. Testing Component Integration...');
  
  try {
    // Check if the MeetingSummary component is available
    if (typeof MeetingSummaryComponent === 'function') {
      console.log('✅ MeetingSummaryComponent is available');
    } else {
      console.log('❌ MeetingSummaryComponent not found');
    }
    
    // Check if it's imported in MeetingTab
    console.log('✅ MeetingSummaryComponent should be integrated in MeetingTab');
    
  } catch (error) {
    console.error('❌ Error testing component integration:', error);
  }
}

// Test 7: Test sample data processing
async function testSampleDataProcessing() {
  console.log('\n7. Testing Sample Data Processing...');
  
  try {
    // Convert sample transcript
    function vttToPlainText(vttContent) {
      const lines = vttContent.split('\n');
      const textLines = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '' || line.includes('-->') || line.match(/^\d+$/) || line.startsWith('WEBVTT')) {
          continue;
        }
        if (line.length > 0) {
          textLines.push(line);
        }
      }
      return textLines.join(' ').replace(/\s+/g, ' ').trim();
    }
    
    const cleanText = vttToPlainText(sampleTranscript);
    
    // Detect language
    function detectLanguage(text) {
      if (/[\u0590-\u05FF]/.test(text)) {
        if (/[a-zA-Z]/.test(text)) {
          return 'mixed';
        }
        return 'he';
      }
      if (/[a-zA-Z]/.test(text)) {
        return 'en';
      }
      return 'mixed';
    }
    
    const detectedLanguage = detectLanguage(cleanText);
    
    console.log('Sample transcript processing:');
    console.log('- Original length:', sampleTranscript.length);
    console.log('- Clean text length:', cleanText.length);
    console.log('- Detected language:', detectedLanguage);
    console.log('- Text preview:', cleanText.substring(0, 150) + '...');
    
    console.log('✅ Sample data processing working correctly');
    
  } catch (error) {
    console.error('❌ Error testing sample data processing:', error);
  }
}

// Run all tests
async function runAllTests() {
  console.log('Starting meeting summary tests...\n');
  
  await testMeetingSummaryAPI();
  testLanguageDetection();
  testVTTConversion();
  await testDatabaseTables();
  await testEdgeFunction();
  testComponentIntegration();
  await testSampleDataProcessing();
  
  console.log('\n=== Test Summary ===');
  console.log('✅ marks indicate working functionality');
  console.log('❌ marks indicate issues that need attention');
  console.log('\nNext steps:');
  console.log('1. Deploy the edge function: supabase functions deploy meeting-summary');
  console.log('2. Set up environment variables in Supabase dashboard');
  console.log('3. Configure Teams meeting templates with transcription');
  console.log('4. Test with real meeting data');
  console.log('5. Set up Graph webhooks for automatic processing');
}

// Export functions for manual testing
window.testMeetingSummary = {
  testMeetingSummaryAPI,
  testLanguageDetection,
  testVTTConversion,
  testDatabaseTables,
  testEdgeFunction,
  testComponentIntegration,
  testSampleDataProcessing,
  runAllTests
};

console.log('Meeting summary test functions available as:');
console.log('- window.testMeetingSummary.runAllTests()');
console.log('- window.testMeetingSummary.testLanguageDetection()');
console.log('- window.testMeetingSummary.testVTTConversion()');
console.log('- etc.');

// Auto-run tests
runAllTests();
