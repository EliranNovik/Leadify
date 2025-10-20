// Script to check what business accounts are accessible
import axios from 'axios';

async function checkAccessibleAccounts() {
  try {
    console.log('🔍 Checking accessible business accounts...');
    
    const accessToken = process.env.ACCESS_TOKEN || 'your-access-token';
    
    // Get business accounts
    const accountsResponse = await axios.get(
      'https://graph.facebook.com/v19.0/me/accounts',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('📋 Accessible business accounts:');
    console.log('Total accounts:', accountsResponse.data.data?.length || 0);
    
    if (accountsResponse.data.data && accountsResponse.data.data.length > 0) {
      accountsResponse.data.data.forEach((account, index) => {
        console.log(`${index + 1}. ${account.name} (ID: ${account.id})`);
      });
      
      // Check each account for templates
      for (const account of accountsResponse.data.data) {
        console.log(`\n🔍 Checking templates for: ${account.name} (${account.id})`);
        
        try {
          const templatesResponse = await axios.get(
            `https://graph.facebook.com/v19.0/${account.id}/message_templates`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          const templates = templatesResponse.data.data || [];
          console.log(`📋 Templates found: ${templates.length}`);
          
          if (templates.length > 0) {
            templates.forEach(template => {
              console.log(`  - ${template.name} (Status: ${template.status})`);
            });
            
            // Check for the templates we're looking for
            const secondTest = templates.find(t => t.name === 'second_test');
            const helloWorld = templates.find(t => t.name === 'hello_world');
            
            if (secondTest) {
              console.log(`\n✅ Found second_test in ${account.name}!`);
              console.log(`Status: ${secondTest.status}`);
              console.log(`Business Account ID: ${account.id}`);
            }
            
            if (helloWorld) {
              console.log(`\n✅ Found hello_world in ${account.name}!`);
              console.log(`Status: ${helloWorld.status}`);
              console.log(`Business Account ID: ${account.id}`);
            }
          }
          
        } catch (templateError) {
          console.log(`❌ Error getting templates: ${templateError.response?.data?.error?.message || templateError.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

checkAccessibleAccounts();
