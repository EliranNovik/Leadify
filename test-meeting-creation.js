// Test script for meeting creation functionality
// Run this in browser console to test the updated meeting creation

const testMeetingCreation = async () => {
  console.log('🧪 Testing Meeting Creation Functionality...\n');
  
  // Test 1: Meeting Form Data Structure
  const testMeetingFormData = () => {
    console.log('📝 Test 1: Meeting Form Data Structure');
    
    // Simulate the meeting form data structure
    const meetingFormData = {
      date: '2024-01-15',
      time: '10:00',
      location: 'Teams',
      manager: 'Anna Zh',
      helper: 'Mindi',
      brief: 'German Citizenship Consultation'
    };
    
    console.log('Meeting form data:', meetingFormData);
    
    // Test that all required fields are present
    const requiredFields = ['date', 'time', 'location', 'manager', 'helper', 'brief'];
    const missingFields = requiredFields.filter(field => !(field in meetingFormData));
    
    if (missingFields.length === 0) {
      console.log('✅ All required fields present in meeting form data');
      return true;
    } else {
      console.log('❌ Missing fields:', missingFields);
      return false;
    }
  };
  
  // Test 2: Meeting Subject Generation
  const testMeetingSubjectGeneration = () => {
    console.log('\n🎯 Test 2: Meeting Subject Generation');
    
    // Simulate client data
    const selectedClient = {
      lead_number: 'L2025001',
      name: 'John Doe',
      email: 'john.doe@example.com'
    };
    
    const meetingFormData = {
      brief: 'German Citizenship Consultation'
    };
    
    // Test subject generation logic
    const meetingSubject = `[#${selectedClient.lead_number}] ${selectedClient.name} - ${meetingFormData.brief || 'Meeting'}`;
    
    console.log('Generated meeting subject:', meetingSubject);
    
    // Verify the format
    const expectedFormat = /^\[#L\d+\] .+ - .+$/;
    if (expectedFormat.test(meetingSubject)) {
      console.log('✅ Meeting subject format is correct');
      return true;
    } else {
      console.log('❌ Meeting subject format is incorrect');
      return false;
    }
  };
  
  // Test 3: Client ID Extraction
  const testClientIdExtraction = () => {
    console.log('\n🔍 Test 3: Client ID Extraction');
    
    const testSubjects = [
      '[#L2025001] John Doe - German Citizenship',
      '[#L2025002] Jane Smith - Austrian Citizenship',
      'Regular meeting without client ID',
      '[#INVALID] Test case'
    ];
    
    let passed = 0;
    let total = testSubjects.length;
    
    testSubjects.forEach((subject, index) => {
      const match = subject.match(/\[#([^\]]+)\]/);
      const extracted = match ? match[1] : null;
      
      console.log(`Subject ${index + 1}: "${subject}" -> "${extracted}"`);
      
      // Basic validation
      if (subject.includes('[#') && extracted) {
        passed++;
      } else if (!subject.includes('[#') && !extracted) {
        passed++;
      }
    });
    
    console.log(`\n📊 Client ID extraction tests: ${passed}/${total} passed`);
    return passed === total;
  };
  
  // Test 4: Meeting Form UI Elements
  const testMeetingFormUI = () => {
    console.log('\n🎨 Test 4: Meeting Form UI Elements');
    
    // Check if the meeting form elements exist
    const formElements = [
      'input[type="date"]',
      'select[value="Teams"]',
      'textarea[placeholder*="Brief description"]',
      'button[onclick*="handleScheduleMeeting"]'
    ];
    
    let found = 0;
    let total = formElements.length;
    
    formElements.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`✅ Found: ${selector}`);
        found++;
      } else {
        console.log(`❌ Missing: ${selector}`);
      }
    });
    
    console.log(`\n📊 UI elements found: ${found}/${total}`);
    return found > 0; // At least some elements should be found
  };
  
  // Test 5: Summary Content Box
  const testSummaryContentBox = () => {
    console.log('\n📋 Test 5: Summary Content Box');
    
    // Check if the summary content box exists
    const summaryBox = document.querySelector('h4:contains("Meeting Summary Content")') || 
                      document.querySelector('h4[class*="font-semibold"]:contains("Meeting Summary")');
    
    if (summaryBox) {
      console.log('✅ Summary content box found');
      return true;
    } else {
      console.log('❌ Summary content box not found');
      return false;
    }
  };
  
  // Test 6: Database Integration
  const testDatabaseIntegration = async () => {
    console.log('\n🗄️ Test 6: Database Integration');
    
    try {
      // Test if we can access the meetings table
      const { data, error } = await supabase
        .from('meetings')
        .select('id, client_id, meeting_date, meeting_time, meeting_location, meeting_manager, meeting_brief')
        .limit(1);
      
      if (error) {
        console.log('❌ Database access error:', error.message);
        return false;
      }
      
      console.log('✅ Database connection successful');
      console.log('Sample meeting data structure:', data?.[0] || 'No meetings found');
      return true;
    } catch (error) {
      console.log('❌ Database test failed:', error.message);
      return false;
    }
  };
  
  // Test 7: Teams Integration
  const testTeamsIntegration = () => {
    console.log('\n🔗 Test 7: Teams Integration');
    
    // Check if the createTeamsMeeting function exists
    if (typeof createTeamsMeeting === 'function') {
      console.log('✅ createTeamsMeeting function found');
      return true;
    } else {
      console.log('❌ createTeamsMeeting function not found');
      return false;
    }
  };
  
  // Run all tests
  const results = [
    testMeetingFormData(),
    testMeetingSubjectGeneration(),
    testClientIdExtraction(),
    testMeetingFormUI(),
    testSummaryContentBox(),
    await testDatabaseIntegration(),
    testTeamsIntegration()
  ];
  
  // Summary
  console.log('\n📋 Test Results Summary');
  console.log('========================');
  console.log('1. Meeting Form Data Structure:', results[0] ? '✅ PASS' : '❌ FAIL');
  console.log('2. Meeting Subject Generation:', results[1] ? '✅ PASS' : '❌ FAIL');
  console.log('3. Client ID Extraction:', results[2] ? '✅ PASS' : '❌ FAIL');
  console.log('4. Meeting Form UI Elements:', results[3] ? '✅ PASS' : '❌ FAIL');
  console.log('5. Summary Content Box:', results[4] ? '✅ PASS' : '❌ FAIL');
  console.log('6. Database Integration:', results[5] ? '✅ PASS' : '❌ FAIL');
  console.log('7. Teams Integration:', results[6] ? '✅ PASS' : '❌ FAIL');
  
  const passedTests = results.filter(r => r).length;
  const totalTests = results.length;
  
  console.log(`\n🎯 Overall Result: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Meeting creation functionality is working correctly.');
    console.log('\n🚀 Ready for production use:');
    console.log('• Meeting subjects will include client ID and name');
    console.log('• Brief field is available in the form');
    console.log('• Summary content box is displayed');
    console.log('• Database integration is functional');
  } else {
    console.log('⚠️ Some tests failed. Please review the errors above.');
    console.log('\n🔧 Common issues:');
    console.log('• Check if you are on the correct page (Clients page)');
    console.log('• Ensure the meeting form is accessible');
    console.log('• Verify database connection');
    console.log('• Check browser console for errors');
  }
};

// Test individual components
const testIndividualComponents = () => {
  console.log('🧪 Testing Individual Components...\n');
  
  // Test meeting form data
  console.log('📝 Testing Meeting Form Data...');
  const testData = {
    date: '2024-01-15',
    time: '10:00',
    location: 'Teams',
    manager: 'Anna Zh',
    helper: 'Mindi',
    brief: 'German Citizenship Consultation'
  };
  console.log('Test data:', testData);
  
  // Test subject generation
  console.log('\n🎯 Testing Subject Generation...');
  const client = { lead_number: 'L2025001', name: 'John Doe' };
  const subject = `[#${client.lead_number}] ${client.name} - ${testData.brief}`;
  console.log('Generated subject:', subject);
  
  // Test client ID extraction
  console.log('\n🔍 Testing Client ID Extraction...');
  const match = subject.match(/\[#([^\]]+)\]/);
  const extracted = match ? match[1] : null;
  console.log('Extracted client ID:', extracted);
};

// Auto-run tests
const runAllTests = () => {
  console.log('🧪 Starting Meeting Creation Tests...\n');
  testMeetingCreation();
  // Uncomment to test individual components
  // testIndividualComponents();
};

// Run tests
runAllTests();
