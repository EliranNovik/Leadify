// Script to check and fix WhatsApp configuration
import axios from 'axios';

async function checkWhatsAppConfig() {
  try {
    console.log('🔍 Checking WhatsApp configuration...');
    
    // Your access token (replace with actual token)
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || 'your-access-token';
    
    // Check what phone numbers are available
    const phoneNumbersResponse = await axios.get(
      'https://graph.facebook.com/v19.0/me/phone_numbers',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('📱 Available phone numbers:');
    phoneNumbersResponse.data.data.forEach((phone, index) => {
      console.log(`${index + 1}. ID: ${phone.id}, Display Name: ${phone.display_phone_number}, Status: ${phone.status}`);
    });
    
    // Check templates for each phone number
    for (const phone of phoneNumbersResponse.data.data) {
      console.log(`\n🔍 Checking templates for phone number: ${phone.display_phone_number} (ID: ${phone.id})`);
      
      try {
        const templatesResponse = await axios.get(
          `https://graph.facebook.com/v19.0/${phone.id}/message_templates`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`📋 Templates found: ${templatesResponse.data.data?.length || 0}`);
        
        if (templatesResponse.data.data) {
          templatesResponse.data.data.forEach(template => {
            console.log(`  - ${template.name} (Status: ${template.status})`);
          });
        }
        
        // Check if second_test exists
        const secondTest = templatesResponse.data.data?.find(t => t.name === 'second_test');
        if (secondTest) {
          console.log(`✅ Found second_test template! Status: ${secondTest.status}`);
          console.log(`🎯 Use this PHONE_NUMBER_ID in your .env: ${phone.id}`);
        }
        
      } catch (error) {
        console.log(`❌ Error checking templates for ${phone.display_phone_number}:`, error.response?.data || error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkWhatsAppConfig();
