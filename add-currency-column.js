const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function addCurrencyColumn() {
  try {
    console.log('Adding currency column to payment_plans table...');
    
    const { data, error } = await supabase
      .rpc('exec_sql', {
        sql: 'ALTER TABLE payment_plans ADD COLUMN IF NOT EXISTS currency TEXT;'
      });
    
    if (error) {
      console.error('Error adding currency column:', error);
    } else {
      console.log('✅ Currency column added successfully');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

addCurrencyColumn();
