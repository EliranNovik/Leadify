// Test 1com API directly with different date formats
import fetch from 'node-fetch';

const API_KEY = 'Lufbp2hYHplrwMCZ';
const TENANT = 'decker';
const BASE_URL = 'https://pbx6webserver.1com.co.il/pbx/proxyapi.php';

async function testDirectAPI() {
  console.log('🧪 Testing 1com API directly...\n');
  
  // Try different date formats for October 1st, 2025
  const testDates = [
    '2025-10-01',    // YYYY-MM-DD
    '01-10-2025',    // DD-MM-YYYY  
    '10/01/2025',    // MM/DD/YYYY
    '01/10/2025',    // DD/MM/YYYY
    '2025/10/01',    // YYYY/MM/DD
  ];
  
  for (const dateStr of testDates) {
    console.log(`\n🔍 Testing date format: ${dateStr}`);
    
    const url = `${BASE_URL}?key=${API_KEY}&reqtype=INFO&info=CDRS&format=csv&tenant=${TENANT}&start=${dateStr}&end=${dateStr}`;
    console.log(`URL: ${url}`);
    
    try {
      const response = await fetch(url);
      const text = await response.text();
      
      console.log(`Status: ${response.status}`);
      console.log(`Response length: ${text.length} characters`);
      
      if (text.includes('Too bad')) {
        console.log('❌ API Key error');
      } else if (text.includes('No call logs found')) {
        console.log('✅ API working, no data for this date');
      } else if (text.includes(',')) {
        const lines = text.split('\n').length - 1;
        console.log(`✅ Found data! ${lines} lines`);
        console.log(`First few lines:`);
        console.log(text.split('\n').slice(0, 3).join('\n'));
      } else {
        console.log(`📝 Response: ${text.substring(0, 200)}...`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
  
  // Also try getting help to see available endpoints
  console.log('\n\n🔍 Testing HELP endpoint...');
  const helpUrl = `${BASE_URL}?key=${API_KEY}&reqtype=HELP`;
  try {
    const response = await fetch(helpUrl);
    const text = await response.text();
    console.log(`Help response: ${text.substring(0, 500)}...`);
  } catch (error) {
    console.log(`Help error: ${error.message}`);
  }
}

testDirectAPI().catch(console.error);
