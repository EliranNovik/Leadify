const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10Y2N5ZXZ1b3NxZnJjYW96dHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ5NzI5NzQsImV4cCI6MjA1MDU0ODk3NH0.Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testCurrencyFields() {
  console.log('🔍 Testing currency fields in leads_lead table...');
  
  try {
    // First, let's get a sample legacy lead to see what fields are available
    const { data: sampleLead, error: sampleError } = await supabase
      .from('leads_lead')
      .select('*')
      .limit(1);
    
    if (sampleError) {
      console.error('Error fetching sample lead:', sampleError);
      return;
    }
    
    if (sampleLead && sampleLead.length > 0) {
      const lead = sampleLead[0];
      console.log('🔍 Sample lead fields:', Object.keys(lead));
      
      // Check for currency-related fields
      const currencyFields = Object.keys(lead).filter(key => 
        key.toLowerCase().includes('currency') || 
        key.toLowerCase().includes('curr')
      );
      
      console.log('🔍 Currency-related fields found:', currencyFields);
      
      if (currencyFields.length > 0) {
        currencyFields.forEach(field => {
          console.log(`🔍 ${field}:`, lead[field]);
        });
      }
      
      // Check if currency_id exists
      if ('currency_id' in lead) {
        console.log('🔍 currency_id found:', lead.currency_id);
        
        // Try to join with accounting_currencies
        const { data: currencyData, error: currencyError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            currency_id,
            accounting_currencies!currency_id(iso_code)
          `)
          .eq('id', lead.id);
        
        if (currencyError) {
          console.error('Error with currency join:', currencyError);
        } else {
          console.log('🔍 Currency join result:', currencyData);
        }
      } else {
        console.log('🔍 currency_id field not found in leads_lead table');
      }
    }
    
  } catch (error) {
    console.error('Error in test:', error);
  }
}

testCurrencyFields();
