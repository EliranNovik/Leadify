import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = 'https://mtccyevuosqfrcaoztzt.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10Y2N5ZXZ1b3NxZnJjYW96dHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ5NzI5NzQsImV4cCI6MjA1MDU0ODk3NH0.Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8Ej8';
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugStageMapping() {
  console.log('🔍 Debugging stage mapping...\n');

  // 1. Check what's in the lead_stages table
  console.log('1. Checking lead_stages table:');
  const { data: stagesData, error: stagesError } = await supabase
    .from('lead_stages')
    .select('*');
  
  if (stagesError) {
    console.error('❌ Error fetching stages:', stagesError);
  } else {
    console.log('✅ Stages in database:', stagesData);
  }

  // 2. Check the specific client's stage
  console.log('\n2. Checking client 178050 stage:');
  const { data: clientData, error: clientError } = await supabase
    .from('leads_lead')
    .select('stage')
    .eq('id', 178050)
    .single();
  
  if (clientError) {
    console.error('❌ Error fetching client:', clientError);
  } else {
    console.log('✅ Client stage:', clientData?.stage);
  }

  // 3. Test the stage mapping
  console.log('\n3. Testing stage mapping:');
  if (stagesData && clientData?.stage) {
    const stageMapping = {};
    stagesData.forEach(stage => {
      stageMapping[stage.id] = stage.name || stage.id;
    });
    
    console.log('Stage mapping:', stageMapping);
    console.log('Client stage ID:', clientData.stage);
    console.log('Mapped stage name:', stageMapping[clientData.stage] || 'NOT FOUND');
  }

  // 4. Check if there are any stages with the same ID as the client's stage
  if (clientData?.stage && stagesData) {
    const matchingStage = stagesData.find(s => s.id === clientData.stage);
    console.log('\n4. Direct match check:');
    console.log('Matching stage:', matchingStage);
  }
}

debugStageMapping().catch(console.error);
