// Test script to verify calendar access permissions
// Run this in the browser console to test calendar access

async function testCalendarAccess() {
  console.log('🔍 Testing calendar access...');
  
  // Test both calendars
  const calendars = [
    'shared-potentialclients@lawoffice.org.il',
    'shared-newclients@lawoffice.org.il'
  ];
  
  for (const calendarEmail of calendars) {
    try {
      console.log(`\n📅 Testing access to: ${calendarEmail}`);
      
      // Get access token (you'll need to be logged in)
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('msal.accessToken') || 'YOUR_TOKEN_HERE'}`
        }
      });
      
      if (!response.ok) {
        console.error('❌ No valid access token found. Please log in first.');
        return;
      }
      
      // Test calendar access
      const calendarResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(calendarEmail)}/calendar`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('msal.accessToken') || 'YOUR_TOKEN_HERE'}`
        }
      });
      
      if (calendarResponse.ok) {
        const calendarData = await calendarResponse.json();
        console.log(`✅ Access confirmed for ${calendarEmail}:`, calendarData.name);
      } else {
        const error = await calendarResponse.json();
        console.error(`❌ Access denied for ${calendarEmail}:`, error);
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${calendarEmail}:`, error);
    }
  }
}

// Instructions
console.log(`
🔧 Calendar Access Test Instructions:

1. Open browser console (F12)
2. Make sure you're logged in to the application
3. Run: testCalendarAccess()

This will test access to both calendars:
- shared-potentialclients@lawoffice.org.il
- shared-newclients@lawoffice.org.il

If you get access denied errors, you may need to:
1. Check if the shared mailboxes exist
2. Verify you have permissions to access them
3. Contact your Microsoft 365 administrator
`);

// Export the function
window.testCalendarAccess = testCalendarAccess;
