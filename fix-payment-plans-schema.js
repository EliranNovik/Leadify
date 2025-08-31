const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function fixPaymentPlansSchema() {
  console.log('🔧 Fixing payment_plans table schema...');
  
  try {
    // Run the SQL to fix the lead_id column type
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Fix payment_plans.lead_id column type to match leads.id (uuid)
        -- First, drop any foreign key constraints
        ALTER TABLE payment_plans 
        DROP CONSTRAINT IF EXISTS payment_plans_lead_id_fkey;

        -- Clear existing data since we can't convert bigint to uuid
        DELETE FROM payment_plans;

        -- Drop the old lead_id column
        ALTER TABLE payment_plans 
        DROP COLUMN IF EXISTS lead_id;

        -- Add the new lead_id column with correct type
        ALTER TABLE payment_plans 
        ADD COLUMN lead_id uuid;

        -- Add back the foreign key constraint
        ALTER TABLE payment_plans 
        ADD CONSTRAINT payment_plans_lead_id_fkey 
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

        -- Add comment for documentation
        COMMENT ON COLUMN payment_plans.lead_id IS 'Reference to leads table (UUID)';
      `
    });

    if (error) {
      console.error('❌ Error fixing payment_plans schema:', error);
    } else {
      console.log('✅ Successfully fixed payment_plans schema');
    }
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

fixPaymentPlansSchema();
