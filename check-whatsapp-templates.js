// Script to check what templates are available in your WhatsApp Business Account
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// You'll need to replace these with your actual values
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'your-supabase-url';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'your-supabase-anon-key';
const whatsappToken = process.env.WHATSAPP_TOKEN || 'your-whatsapp-token';
const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || 'your-phone-number-id';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkWhatsAppTemplates() {
  try {
    console.log('🔍 Checking WhatsApp Business Account templates...');
    
    // Get templates from Meta API
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${whatsappPhoneNumberId}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('📋 Templates from Meta API:', response.data);
    
    // Get templates from your database
    const { data: dbTemplates, error } = await supabase
      .from('whatsapp_whatsapptemplate')
      .select('*')
      .order('title');
    
    if (error) {
      console.error('❌ Error fetching database templates:', error);
      return;
    }
    
    console.log('📋 Templates from database:', dbTemplates);
    
    // Compare them
    const metaTemplateNames = response.data.data?.map(t => t.name) || [];
    const dbTemplateNames = dbTemplates?.map(t => t.name360) || [];
    
    console.log('\n🔍 Comparison:');
    console.log('Meta API templates:', metaTemplateNames);
    console.log('Database templates:', dbTemplateNames);
    
    const missingInMeta = dbTemplateNames.filter(name => !metaTemplateNames.includes(name));
    const missingInDB = metaTemplateNames.filter(name => !dbTemplateNames.includes(name));
    
    console.log('\n❌ Templates in database but NOT in Meta:', missingInMeta);
    console.log('❌ Templates in Meta but NOT in database:', missingInDB);
    
    if (missingInMeta.includes('second_test')) {
      console.log('\n🚨 ISSUE FOUND: second_test is in your database but NOT in Meta API!');
      console.log('This explains why you get the error when trying to send it.');
      console.log('Solutions:');
      console.log('1. Remove second_test from your database');
      console.log('2. Create second_test template in Meta Business Manager');
      console.log('3. Use a different template that exists in Meta');
    }
    
  } catch (error) {
    console.error('❌ Error checking templates:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

checkWhatsAppTemplates();
