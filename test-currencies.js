import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function checkCurrencies() {
  console.log('🔍 Checking accounting_currencies table...');
  
  // First, let's see what's in the table
  const { data: allCurrencies, error: allError } = await supabase
    .from('accounting_currencies')
    .select('*');
  
  if (allError) {
    console.error('❌ Error fetching all currencies:', allError);
    return;
  }
  
  console.log('📊 All currencies in table:', allCurrencies);
  
  // Now let's specifically check for ID 1
  const { data: currency1, error: currency1Error } = await supabase
    .from('accounting_currencies')
    .select('*')
    .eq('id', 1)
    .single();
  
  if (currency1Error) {
    console.error('❌ Error fetching currency ID 1:', currency1Error);
  } else {
    console.log('✅ Currency ID 1 found:', currency1);
  }
  
  // Let's also check if there are any currencies at all
  const { count, error: countError } = await supabase
    .from('accounting_currencies')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    console.error('❌ Error counting currencies:', countError);
  } else {
    console.log('📈 Total currencies in table:', count);
  }
}

checkCurrencies().catch(console.error);
