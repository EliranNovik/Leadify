const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function addIndexes() {
  try {
    console.log('🚀 Adding missing indexes for leads_lead table...');

    // Read the SQL file
    const fs = require('fs');
    const path = require('path');
    const sqlPath = path.join(__dirname, 'sql', 'add_missing_indexes_and_fkeys.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolon and filter out empty statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`📋 Found ${statements.length} SQL statements to execute`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip foreign key constraints for now (they're commented out)
      if (statement.includes('FOREIGN KEY') || statement.includes('ALTER TABLE')) {
        console.log(`⏭️  Skipping foreign key constraint: ${statement.substring(0, 100)}...`);
        continue;
      }

      try {
        console.log(`🔧 Executing statement ${i + 1}/${statements.length}...`);
        console.log(`📝 ${statement.substring(0, 100)}...`);
        
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          if (error.message.includes('already exists')) {
            console.log(`✅ Index already exists (expected)`);
          } else {
            console.error(`❌ Error executing statement:`, error.message);
          }
        } else {
          console.log(`✅ Statement executed successfully`);
        }
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`✅ Index already exists (expected)`);
        } else {
          console.error(`❌ Error executing statement:`, err.message);
        }
      }
    }

    console.log('🎉 Index creation completed!');

    // Now check the data formats
    console.log('\n🔍 Checking role column data formats...');
    await checkDataFormats();

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function checkDataFormats() {
  try {
    const { data, error } = await supabase
      .from('leads_lead')
      .select('case_handler_id, expert_id, closer_id, meeting_scheduler_id, meeting_manager_id')
      .not('case_handler_id', 'is', null)
      .limit(10);

    if (error) {
      console.error('❌ Error checking data formats:', error.message);
      return;
    }

    console.log('📊 Sample role column data:');
    console.log('case_handler_id samples:', data.map(row => row.case_handler_id).slice(0, 5));
    console.log('expert_id samples:', data.map(row => row.expert_id).slice(0, 5));
    console.log('closer_id samples:', data.map(row => row.closer_id).slice(0, 5));
    console.log('meeting_scheduler_id samples:', data.map(row => row.meeting_scheduler_id).slice(0, 5));
    console.log('meeting_manager_id samples:', data.map(row => row.meeting_manager_id).slice(0, 5));

  } catch (error) {
    console.error('❌ Error checking data formats:', error.message);
  }
}

// Run the script
addIndexes();
