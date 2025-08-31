const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function testMeetingLocations() {
  console.log('🔍 Testing tenants_meetinglocation table...');
  
  // First, check if we can access the table
  const { data: existingData, error: fetchError } = await supabase
    .from('tenants_meetinglocation')
    .select('*');
  
  console.log('📊 Existing meeting locations:', existingData);
  console.log('❌ Fetch error:', fetchError);
  
  if (fetchError) {
    console.log('🚨 Error accessing table. This might be an RLS issue.');
    return;
  }
  
  if (!existingData || existingData.length === 0) {
    console.log('📝 Table is empty. Inserting sample data...');
    
    const sampleLocations = [
      { id: 1, name: 'Jerusalem Office', default_link: null, firm_id: 1, address: 'Jerusalem, Israel', order: 1, occupancy_gap: null },
      { id: 2, name: 'Tel Aviv Office', default_link: null, firm_id: 1, address: 'Tel Aviv, Israel', order: 2, occupancy_gap: null },
      { id: 3, name: 'Haifa Office', default_link: null, firm_id: 1, address: 'Haifa, Israel', order: 3, occupancy_gap: null },
      { id: 4, name: 'Teams', default_link: null, firm_id: 1, address: 'Online Meeting', order: 4, occupancy_gap: null },
      { id: 5, name: 'Client Office', default_link: null, firm_id: 1, address: 'Client Location', order: 5, occupancy_gap: null },
      { id: 6, name: 'Other', default_link: null, firm_id: 1, address: 'Other Location', order: 6, occupancy_gap: null }
    ];
    
    const { data: insertData, error: insertError } = await supabase
      .from('tenants_meetinglocation')
      .insert(sampleLocations);
    
    console.log('✅ Insert result:', insertData);
    console.log('❌ Insert error:', insertError);
    
    if (!insertError) {
      console.log('🎉 Sample meeting locations inserted successfully!');
      
      // Verify the data was inserted
      const { data: verifyData, error: verifyError } = await supabase
        .from('tenants_meetinglocation')
        .select('*')
        .order('order', { ascending: true });
      
      console.log('🔍 Verification - All meeting locations:', verifyData);
      console.log('❌ Verification error:', verifyError);
    }
  } else {
    console.log('✅ Table has data. No need to insert sample data.');
  }
}

testMeetingLocations().catch(console.error);
