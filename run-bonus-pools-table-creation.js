const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function createBonusPoolsTable() {
  try {
    console.log('🏗️  Creating monthly bonus pools table...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, 'sql', 'create_monthly_bonus_pools_table.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Execute the SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql: sqlContent });
    
    if (error) {
      console.error('❌ Error creating monthly bonus pools table:', error);
      return;
    }
    
    console.log('✅ Monthly bonus pools table created successfully!');
    console.log('📊 Table structure:');
    console.log('   - id (UUID, Primary Key)');
    console.log('   - year (INTEGER)');
    console.log('   - month (INTEGER, 1-12)');
    console.log('   - total_bonus_pool (DECIMAL)');
    console.log('   - total_revenue (DECIMAL)');
    console.log('   - pool_percentage (GENERATED, auto-calculated)');
    console.log('   - created_at, updated_at (TIMESTAMPS)');
    console.log('   - created_by, updated_by (BIGINT)');
    console.log('   - UNIQUE constraint on (year, month)');
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the creation
createBonusPoolsTable();
