const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('   VITE_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createSalaryTable() {
  try {
    console.log('🚀 Creating employee_salaries table...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'sql', 'create_employee_salaries_table.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });
    
    if (error) {
      console.error('❌ Error creating table:', error);
      return;
    }
    
    console.log('✅ Employee salaries table created successfully!');
    console.log('📋 Table features:');
    console.log('   - Stores monthly salary records per employee');
    console.log('   - Unique constraint on employee_id + year + month');
    console.log('   - Row Level Security (RLS) enabled');
    console.log('   - Automatic timestamp updates');
    console.log('   - Proper indexing for performance');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the table creation
createSalaryTable();
