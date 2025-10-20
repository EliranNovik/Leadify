// Simple script to test template sending
import axios from 'axios';

// Test sending a template that should exist
async function testTemplateSending() {
  try {
    console.log('🧪 Testing template sending...');
    
    // You'll need to replace these with your actual values
    const whatsappToken = process.env.WHATSAPP_TOKEN || 'your-whatsapp-token';
    const whatsappPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || 'your-phone-number-id';
    
    // Test with hello_world template (this should exist)
    const testPayload = {
      messaging_product: 'whatsapp',
      to: '972507825939', // Your test number
      type: 'template',
      template: {
        name: 'hello_world',
        language: {
          code: 'en_US'
        }
      }
    };
    
    console.log('📤 Sending test template:', testPayload);
    
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${whatsappPhoneNumberId}/messages`,
      testPayload,
      {
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Template sent successfully:', response.data);
    
  } catch (error) {
    console.error('❌ Error sending template:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testTemplateSending();
