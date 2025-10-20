// Test script to simulate WhatsApp webhook for unknown leads
// Run this with: node test-whatsapp-webhook.js

import axios from 'axios';

// Your webhook URL (update this to your actual deployed backend URL)
const webhookUrl = 'https://your-deployed-backend-url.com/api/whatsapp/webhook';

// Simulate a message from an unknown phone number
const testPayload = {
  object: 'whatsapp_business_account',
  entry: [{
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '972501234567',
          phone_number_id: 'your_phone_number_id'
        },
        contacts: [{
          profile: {
            name: 'Test User'
          },
          wa_id: '972507825939' // This should be an unknown number
        }],
        messages: [{
          from: '972507825939', // Unknown phone number
          id: 'test_message_id_' + Date.now(),
          timestamp: Math.floor(Date.now() / 1000).toString(),
          text: {
            body: 'Hi, I saw your ad and I\'m interested in your services!'
          },
          type: 'text'
        }]
      }
    }]
  }]
};

async function testWebhook() {
  try {
    console.log('🧪 Testing WhatsApp webhook with unknown lead...');
    console.log('📱 Phone number:', testPayload.entry[0].changes[0].value.messages[0].from);
    console.log('💬 Message:', testPayload.entry[0].changes[0].value.messages[0].text.body);
    
    const response = await axios.post(webhookUrl, testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Webhook response:', response.status);
    console.log('📋 Response data:', response.data);
    
    console.log('\n🎯 Expected result:');
    console.log('- Message should be saved to database');
    console.log('- lead_id should be null (unknown lead)');
    console.log('- sender_name should be the phone number');
    console.log('- Message should appear on WhatsApp Leads page');
    
  } catch (error) {
    console.error('❌ Error testing webhook:', error.response?.data || error.message);
  }
}

// Run the test
testWebhook();
