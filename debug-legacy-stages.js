import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: './env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugLegacyStages() {
  try {
    console.log('🔍 Testing legacy lead stages...');
    
    // Test 1: Check a specific legacy lead
    const legacyId = '178050'; // Using the ID from your previous logs
    console.log(`\n📋 Testing legacy lead ID: ${legacyId}`);
    
    const { data: legacyLead, error: legacyError } = await supabase
      .from('leads_lead')
      .select('id, name, stage')
      .eq('id', legacyId)
      .single();
    
    if (legacyError) {
      console.error('❌ Error fetching legacy lead:', legacyError);
    } else {
      console.log('✅ Legacy lead data:', legacyLead);
      console.log('📊 Stage value:', legacyLead?.stage);
      console.log('📊 Stage type:', typeof legacyLead?.stage);
    }
    
    // Test 2: Check lead_stages table
    console.log('\n📋 Checking lead_stages table...');
    const { data: stageMappings, error: stageError } = await supabase
      .from('lead_stages')
      .select('id, name')
      .order('id');
    
    if (stageError) {
      console.error('❌ Error fetching stage mappings:', stageError);
    } else {
      console.log('✅ Stage mappings found:', stageMappings?.length || 0);
      console.log('📊 Sample mappings:', stageMappings?.slice(0, 5));
    }
    
    // Test 3: Check if stage 110 exists
    console.log('\n📋 Checking for stage 110...');
    const { data: stage110, error: stage110Error } = await supabase
      .from('lead_stages')
      .select('id, name')
      .eq('id', '110')
      .single();
    
    if (stage110Error) {
      console.error('❌ Error fetching stage 110:', stage110Error);
    } else {
      console.log('✅ Stage 110 found:', stage110);
    }
    
    // Test 4: Check proformainvoicerow table
    console.log('\n📋 Checking proformainvoicerow table...');
    const { data: proformaStages, error: proformaError } = await supabase
      .from('proformainvoicerow')
      .select('id, name')
      .order('id');
    
    if (proformaError) {
      console.error('❌ Error fetching proforma stages:', proformaError);
    } else {
      console.log('✅ Proforma stages found:', proformaStages?.length || 0);
      console.log('📊 Sample proforma stages:', proformaStages?.slice(0, 5));
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

debugLegacyStages();
