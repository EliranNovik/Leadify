// Script to check all WhatsApp Business Accounts and find templates
import axios from 'axios';

async function checkAllAccounts() {
  try {
    console.log('🔍 Checking all WhatsApp Business Accounts...');
    
    const accessToken = process.env.ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || 'your-access-token';
    
    // First, get all WhatsApp Business Accounts
    const accountsResponse = await axios.get(
      'https://graph.facebook.com/v19.0/me/accounts',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          fields: 'id,name,access_token,category'
        }
      }
    );
    
    console.log('📋 Available WhatsApp Business Accounts:');
    accountsResponse.data.data.forEach((account, index) => {
      console.log(`${index + 1}. ${account.name} (ID: ${account.id})`);
    });
    
    // Check each account for phone numbers and templates
    for (const account of accountsResponse.data.data) {
      console.log(`\n🔍 Checking account: ${account.name} (${account.id})`);
      
      try {
        // Get phone numbers for this account
        const phoneNumbersResponse = await axios.get(
          `https://graph.facebook.com/v19.0/${account.id}/phone_numbers`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`📱 Phone numbers in this account: ${phoneNumbersResponse.data.data?.length || 0}`);
        
        for (const phone of phoneNumbersResponse.data.data || []) {
          console.log(`  📞 ${phone.display_phone_number} (ID: ${phone.id}, Status: ${phone.status})`);
          
          // Check templates for this phone number
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
            
            const templates = templatesResponse.data.data || [];
            console.log(`    📋 Templates: ${templates.length}`);
            
            if (templates.length > 0) {
              templates.forEach(template => {
                console.log(`      - ${template.name} (Status: ${template.status})`);
              });
              
              // Check for the templates we're looking for
              const secondTest = templates.find(t => t.name === 'second_test');
              const helloWorld = templates.find(t => t.name === 'hello_world');
              
              if (secondTest || helloWorld) {
                console.log(`    🎯 FOUND TEMPLATES! Use this phone number ID: ${phone.id}`);
                console.log(`    📝 Update your .env file: PHONE_NUMBER_ID=${phone.id}`);
              }
            }
            
          } catch (templateError) {
            console.log(`    ❌ Error checking templates: ${templateError.response?.data?.error?.message || templateError.message}`);
          }
        }
        
      } catch (accountError) {
        console.log(`❌ Error checking account ${account.name}: ${accountError.response?.data?.error?.message || accountError.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkAllAccounts();
