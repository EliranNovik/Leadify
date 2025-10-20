// Script to check templates in your current working phone number
import axios from 'axios';

async function checkCurrentPhoneTemplates() {
  try {
    console.log('🔍 Checking templates in your current working phone number...');
    
    const accessToken = process.env.ACCESS_TOKEN || 'your-access-token';
    const phoneNumberId = process.env.PHONE_NUMBER_ID || '601524413037232';
    
    console.log('📱 Checking phone number ID:', phoneNumberId);
    
    // Check templates for your current phone number
    const templatesResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/message_templates`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('📋 Templates in your current phone number:');
    console.log('Total templates:', templatesResponse.data.data?.length || 0);
    
    if (templatesResponse.data.data && templatesResponse.data.data.length > 0) {
      templatesResponse.data.data.forEach((template, index) => {
        console.log(`${index + 1}. ${template.name} - Status: ${template.status} - Category: ${template.category}`);
      });
      
      // Check for the templates we're looking for
      const secondTest = templatesResponse.data.data.find(t => t.name === 'second_test');
      const helloWorld = templatesResponse.data.data.find(t => t.name === 'hello_world');
      
      if (secondTest) {
        console.log('\n✅ Found second_test template!');
        console.log('Status:', secondTest.status);
        console.log('You can use this template with your current configuration!');
      }
      
      if (helloWorld) {
        console.log('\n✅ Found hello_world template!');
        console.log('Status:', helloWorld.status);
        console.log('You can use this template with your current configuration!');
      }
      
      if (!secondTest && !helloWorld) {
        console.log('\n❌ second_test and hello_world not found in your current phone number.');
        console.log('Available template names:', templatesResponse.data.data.map(t => t.name));
      }
      
    } else {
      console.log('❌ No templates found in your current phone number.');
      console.log('This explains why you get "Template name does not exist" error.');
      console.log('You need to either:');
      console.log('1. Create templates in this phone number, or');
      console.log('2. Use a different phone number that has templates');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkCurrentPhoneTemplates();
