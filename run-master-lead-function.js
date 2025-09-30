const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runSQL() {
  try {
    console.log('🚀 Running master lead function SQL...');
    
    // Read the SQL file
    const sql = fs.readFileSync('sql/create_master_lead_view.sql', 'utf8');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('❌ Error running SQL:', error);
      return;
    }
    
    console.log('✅ SQL executed successfully!');
    console.log('📊 Master lead function created with indexes');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

runSQL();
