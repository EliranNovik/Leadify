const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function checkLegacyLeads() {
  console.log('🔍 Checking legacy leads data...');
  
  // Check what values exist in closer_id field
  const { data: closerData, error: closerError } = await supabase
    .from('leads_lead')
    .select('closer_id')
    .not('closer_id', 'is', null);
  
  if (closerError) {
    console.error('Error fetching closer_id data:', closerError);
    return;
  }
  
  console.log('🔍 Unique closer_id values:');
  const uniqueClosers = [...new Set(closerData.map(row => row.closer_id))];
  uniqueClosers.forEach(closer => {
    const count = closerData.filter(row => row.closer_id === closer).length;
    console.log(`  - "${closer}": ${count} leads`);
  });
  
  // Check a few sample leads
  const { data: sampleData, error: sampleError } = await supabase
    .from('leads_lead')
    .select('id, name, closer_id, meeting_scheduler_id')
    .limit(5);
  
  if (sampleError) {
    console.error('Error fetching sample data:', sampleError);
    return;
  }
  
  console.log('\n🔍 Sample legacy leads:');
  sampleData.forEach(lead => {
    console.log(`  - ID: ${lead.id}, Name: "${lead.name}", Closer: "${lead.closer_id}", Scheduler: "${lead.meeting_scheduler_id}"`);
  });
  
  // Check if there are any leads with "Eliran" in any field
  const { data: eliranData, error: eliranError } = await supabase
    .from('leads_lead')
    .select('id, name, closer_id, meeting_scheduler_id, expert_id')
    .or('closer_id.ilike.%Eliran%,meeting_scheduler_id.ilike.%Eliran%,expert_id.ilike.%Eliran%');
  
  if (eliranError) {
    console.error('Error searching for Eliran:', eliranError);
    return;
  }
  
  console.log('\n🔍 Leads containing "Eliran":');
  if (eliranData.length === 0) {
    console.log('  - No leads found with "Eliran" in any field');
  } else {
    eliranData.forEach(lead => {
      console.log(`  - ID: ${lead.id}, Name: "${lead.name}", Closer: "${lead.closer_id}", Scheduler: "${lead.meeting_scheduler_id}", Expert: "${lead.expert_id}"`);
    });
  }
}

checkLegacyLeads().catch(console.error);
