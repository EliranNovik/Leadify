// Script to create a simple template
import axios from 'axios';

async function createSimpleTemplate() {
  try {
    console.log('🔍 Creating a simple template...');
    
    const accessToken = process.env.ACCESS_TOKEN || 'your-access-token';
    const phoneNumberId = process.env.PHONE_NUMBER_ID || '601524413037232';
    
    console.log('📱 Using phone number ID:', phoneNumberId);
    
    // Try to create a simple template
    const templateData = {
      name: 'simple_hello',
      category: 'UTILITY',
      language: 'en_US',
      components: [
        {
          type: 'BODY',
          text: 'Hello! This is a simple test message from our service.'
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
    
    // Now try to send a message using this template
    console.log('\n🧪 Testing template sending...');
    
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: '972507825939', // Your test number
      type: 'template',
      template: {
        name: 'simple_hello',
        language: {
          code: 'en_US'
        }
      }
    };
    
    console.log('📤 Sending test message:', messagePayload);
    
    const messageResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      messagePayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Message sent successfully:', messageResponse.data);
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 100) {
      console.log('\n💡 This suggests that:');
      console.log('1. Your access token is a phone number token, not a business account token');
      console.log('2. Templates need to be created in the business account, not the phone number');
      console.log('3. You need to get a business account access token to create/manage templates');
    }
  }
}

createSimpleTemplate();
