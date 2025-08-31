// Database Setup Script for Meeting Summary System
// Run this in your browser console after logging in

console.log('🗄️ Database Setup for Meeting Summary System');
console.log('============================================\n');

const setupDatabase = async () => {
  console.log('📋 Checking current database state...\n');
  
  try {
    // Check if we're authenticated
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) {
      console.log('❌ Please log in first');
      return;
    }
    console.log('✅ Authenticated as:', sessionData.session.user.email);
    
    // Check existing tables
    console.log('\n📋 Checking existing tables...');
    
    const tables = ['meeting_transcripts', 'meeting_summaries', 'meeting_questionnaires'];
    const tableStatus = {};
    
    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('count')
          .limit(1);
        
        if (error) {
          tableStatus[table] = { exists: false, error: error.message };
        } else {
          tableStatus[table] = { exists: true, error: null };
        }
      } catch (err) {
        tableStatus[table] = { exists: false, error: err.message };
      }
    }
    
    // Display results
    Object.entries(tableStatus).forEach(([table, status]) => {
      if (status.exists) {
        console.log(`✅ ${table} - Table exists`);
      } else {
        console.log(`❌ ${table} - ${status.error}`);
      }
    });
    
    // Check if meetings table has required columns
    console.log('\n📋 Checking meetings table columns...');
    try {
      const { data: meetings, error: meetingsError } = await supabase
        .from('meetings')
        .select('teams_id, meeting_subject, started_at, ended_at, transcript_url')
        .limit(1);
      
      if (meetingsError) {
        console.log('❌ meetings table missing columns:', meetingsError.message);
      } else {
        console.log('✅ meetings table has required columns');
      }
    } catch (err) {
      console.log('❌ Error checking meetings table:', err.message);
    }
    
    // Check if leads table has required columns
    console.log('\n📋 Checking leads table columns...');
    try {
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('auto_email_meeting_summary, language_preference')
        .limit(1);
      
      if (leadsError) {
        console.log('❌ leads table missing columns:', leadsError.message);
      } else {
        console.log('✅ leads table has required columns');
      }
    } catch (err) {
      console.log('❌ Error checking leads table:', err.message);
    }
    
    // Summary
    console.log('\n📋 Setup Summary:');
    const allTablesExist = Object.values(tableStatus).every(status => status.exists);
    
    if (allTablesExist) {
      console.log('✅ All required tables exist');
      console.log('✅ Database is ready for meeting summary system');
      console.log('\n💡 Next steps:');
      console.log('1. Run the test script: test-meeting-summary-system.js');
      console.log('2. Navigate to a client page to see the interface');
    } else {
      console.log('❌ Some tables are missing');
      console.log('💡 Please run the SQL script: sql/create_meeting_summary_tables.sql');
      console.log('   You can do this in your Supabase dashboard under SQL Editor');
    }
    
  } catch (error) {
    console.log('❌ Setup error:', error.message);
  }
};

// Run the setup
setupDatabase();
