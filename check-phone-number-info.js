// Script to check phone number information
import axios from 'axios';

async function checkPhoneNumberInfo() {
  try {
    console.log('🔍 Checking phone number information...');
    
    const accessToken = process.env.ACCESS_TOKEN || 'your-access-token';
    const phoneNumberId = process.env.PHONE_NUMBER_ID || '601524413037232';
    
    console.log('📱 Checking phone number ID:', phoneNumberId);
    
    // Get basic phone number info
    const phoneResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${phoneNumberId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'id,display_phone_number,verified_name,status,code_verification_status'
        }
      }
    );
    
    console.log('📱 Phone number info:', phoneResponse.data);
    
    // Try to get the business account ID from the phone number
    const businessResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${phoneNumberId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'business_account'
        }
      }
    );
    
    console.log('🏢 Business account info:', businessResponse.data);
    
    // If we have a business account, try to get templates from there
    if (businessResponse.data.business_account) {
      const businessId = businessResponse.data.business_account.id;
      console.log('🏢 Business account ID:', businessId);
      
      try {
        const templatesResponse = await axios.get(
          `https://graph.facebook.com/v19.0/${businessId}/message_templates`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log('📋 Templates in business account:');
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
          }
          
          if (helloWorld) {
            console.log('\n✅ Found hello_world template!');
            console.log('Status:', helloWorld.status);
          }
        }
        
      } catch (templateError) {
        console.log('❌ Error getting templates from business account:', templateError.response?.data || templateError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkPhoneNumberInfo();
