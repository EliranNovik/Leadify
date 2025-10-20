// Script to create a template in your working WhatsApp account
import axios from 'axios';

async function createTemplate() {
  try {
    console.log('🔍 Creating template in your working account...');
    
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || 'your-access-token';
    const phoneNumberId = process.env.PHONE_NUMBER_ID || 'your-phone-number-id';
    
    // Create a simple hello_world template
    const templateData = {
      name: 'hello_world',
      category: 'UTILITY',
      language: 'en_US',
      components: [
        {
          type: 'BODY',
          text: 'Hello! Welcome to our service. How can we help you today?'
        }
      ]
    };
    
    console.log('📤 Creating template:', templateData);
    
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/message_templates`,
      templateData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Template created successfully:', response.data);
    
    // Check what templates are now available
    const templatesResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('📋 Available templates in your working account:');
    templatesResponse.data.data?.forEach(template => {
      console.log(`  - ${template.name} (Status: ${template.status})`);
    });
    
  } catch (error) {
    console.error('❌ Error creating template:', error.response?.data || error.message);
  }
}

createTemplate();
