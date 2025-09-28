const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testTableAccess() {
  try {
    console.log('🔍 Testing monthly_bonus_pools table access...');
    
    // Test 1: Simple select
    const { data, error } = await supabase
      .from('monthly_bonus_pools')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Error accessing table:', error);
      return;
    }
    
    console.log('✅ Table access successful');
    console.log('📊 Sample data:', data);
    
    // Test 2: Check table structure
    const { data: structure, error: structureError } = await supabase
      .from('monthly_bonus_pools')
      .select('id, year, month, total_bonus_pool, total_revenue, pool_percentage')
      .limit(0);
    
    if (structureError) {
      console.error('❌ Error checking structure:', structureError);
    } else {
      console.log('✅ Table structure check passed');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testTableAccess();
