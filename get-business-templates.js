// Script to get templates from the business account
import axios from 'axios';

async function getBusinessTemplates() {
  try {
    console.log('🔍 Getting templates from business account...');
    
    const accessToken = process.env.ACCESS_TOKEN || 'your-access-token';
    
    // From your screenshot, the business account ID is 1290806625809676
    const businessAccountId = '1290806625809676';
    
    console.log('🏢 Using business account ID:', businessAccountId);
    
    // Get templates from the business account
    const templatesResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${businessAccountId}/message_templates`,
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
        console.log('You can use this template!');
      }
      
      if (helloWorld) {
        console.log('\n✅ Found hello_world template!');
        console.log('Status:', helloWorld.status);
        console.log('You can use this template!');
      }
      
      // Check which templates are approved and can be used
      const approvedTemplates = templatesResponse.data.data.filter(t => t.status === 'APPROVED');
      const pendingTemplates = templatesResponse.data.data.filter(t => t.status === 'PENDING');
      
      console.log('\n📊 Template Status Summary:');
      console.log('✅ Approved templates:', approvedTemplates.map(t => t.name));
      console.log('⏳ Pending templates:', pendingTemplates.map(t => t.name));
      
      if (approvedTemplates.length > 0) {
        console.log('\n🎯 SOLUTION: Use these approved templates:');
        approvedTemplates.forEach(template => {
          console.log(`  - ${template.name} (${template.category})`);
        });
      }
      
    } else {
      console.log('❌ No templates found in business account.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

getBusinessTemplates();
