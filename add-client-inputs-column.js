const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function addClientInputsColumn() {
  console.log('🔧 Adding client_inputs column to contracts table...');
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add client_inputs column to contracts table to store actual values entered by clients
        ALTER TABLE contracts 
        ADD COLUMN IF NOT EXISTS client_inputs JSONB DEFAULT '{}';

        -- Add comment for documentation
        COMMENT ON COLUMN contracts.client_inputs IS 'JSON object storing client input values for text fields and signatures (e.g., {"text-1": "John Doe", "signature-1": "data:image/png;base64,..."})';
      `
    });

    if (error) {
      console.error('❌ Error adding client_inputs column:', error);
    } else {
      console.log('✅ Successfully added client_inputs column');
    }
  } catch (err) {
    console.error('❌ Error:', err);
  }
}

addClientInputsColumn();
