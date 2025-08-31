// Fixed Supabase Test Script
// Copy and paste this into your browser console after refreshing the page

console.log('🔧 Testing Supabase Access (Fixed)...\n');

// Wait a moment for the app to load
setTimeout(async () => {
  try {
    // Check if supabase is now available globally
    if (typeof window.supabase === 'undefined') {
      console.log('❌ Supabase still not available globally');
      console.log('💡 Make sure you refreshed the page after the code changes');
      console.log('💡 Check that you\'re in development mode');
      return;
    }
    
    console.log('✅ Supabase is available globally!');
    
    // Test authentication
    const { data, error } = await window.supabase.auth.getSession();
    if (error) {
      console.log('❌ Auth error:', error.message);
      return;
    }
    
    if (data.session) {
      console.log('✅ User authenticated:', data.session.user.email);
    } else {
      console.log('❌ User not authenticated - please log in first');
      return;
    }
    
    // Test database tables
    console.log('\n📋 Testing database tables...');
    
    const tables = ['meeting_transcripts', 'meeting_summaries', 'meeting_questionnaires'];
    let allTablesOk = true;
    
    for (const table of tables) {
      try {
        const { data: tableData, error: tableError } = await window.supabase
          .from(table)
          .select('count')
          .limit(1);
        
        if (tableError) {
          console.log(`❌ ${table} - ${tableError.message}`);
          allTablesOk = false;
        } else {
          console.log(`✅ ${table} - OK`);
        }
      } catch (err) {
        console.log(`❌ ${table} - ${err.message}`);
        allTablesOk = false;
      }
    }
    
    if (allTablesOk) {
      console.log('\n🎉 All tests passed!');
      console.log('✅ Supabase is working correctly');
      console.log('✅ Database tables are accessible');
      console.log('\n💡 You can now run the full test script: test-meeting-summary-system.js');
    } else {
      console.log('\n❌ Some database tables are not accessible');
      console.log('💡 Please run the SQL script first: sql/create_meeting_summary_tables_fixed.sql');
    }
    
  } catch (error) {
    console.log('❌ Test error:', error.message);
  }
}, 1000);
