const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    console.log('🚀 Starting migration of role columns to bigint...');

    // Step 1: Check current data types
    console.log('\n📊 Step 1: Checking current data types...');
    await checkCurrentDataTypes();

    // Step 2: Check sample data
    console.log('\n🔍 Step 2: Checking sample data...');
    await checkSampleData();

    // Ask for confirmation before proceeding
    console.log('\n⚠️  WARNING: This migration will:');
    console.log('   1. Clean non-numeric values from role columns');
    console.log('   2. Convert text columns to bigint');
    console.log('   3. Add foreign key constraints');
    console.log('   4. Create performance indexes');
    console.log('\nThis operation cannot be easily undone!');
    
    // For now, let's just run the checks and show what would happen
    console.log('\n✅ Migration script created. Review the SQL file before running.');
    console.log('📁 File: sql/migrate_role_columns_to_bigint.sql');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function checkCurrentDataTypes() {
  try {
    const { data, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_name', 'leads_lead')
      .in('column_name', [
        'case_handler_id', 
        'expert_id', 
        'closer_id', 
        'meeting_scheduler_id', 
        'meeting_manager_id', 
        'meeting_lawyer_id', 
        'exclusive_handler_id', 
        'anchor_id'
      ]);

    if (error) {
      console.error('❌ Error checking data types:', error.message);
      return;
    }

    console.log('📋 Current column types:');
    data.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

  } catch (error) {
    console.error('❌ Error checking data types:', error.message);
  }
}

async function checkSampleData() {
  try {
    // Check case_handler_id samples
    const { data: caseHandlerData } = await supabase
      .from('leads_lead')
      .select('case_handler_id')
      .not('case_handler_id', 'is', null)
      .neq('case_handler_id', '')
      .limit(10);

    console.log('📋 case_handler_id samples:');
    caseHandlerData?.forEach(row => {
      const value = row.case_handler_id;
      const isNumeric = /^[0-9]+$/.test(value);
      console.log(`   "${value}" (numeric: ${isNumeric})`);
    });

    // Check expert_id samples
    const { data: expertData } = await supabase
      .from('leads_lead')
      .select('expert_id')
      .not('expert_id', 'is', null)
      .neq('expert_id', '')
      .limit(10);

    console.log('\n📋 expert_id samples:');
    expertData?.forEach(row => {
      const value = row.expert_id;
      const isNumeric = /^[0-9]+$/.test(value);
      console.log(`   "${value}" (numeric: ${isNumeric})`);
    });

    // Check closer_id samples
    const { data: closerData } = await supabase
      .from('leads_lead')
      .select('closer_id')
      .not('closer_id', 'is', null)
      .neq('closer_id', '')
      .limit(10);

    console.log('\n📋 closer_id samples:');
    closerData?.forEach(row => {
      const value = row.closer_id;
      const isNumeric = /^[0-9]+$/.test(value);
      console.log(`   "${value}" (numeric: ${isNumeric})`);
    });

  } catch (error) {
    console.error('❌ Error checking sample data:', error.message);
  }
}

// Run the migration check
runMigration();
