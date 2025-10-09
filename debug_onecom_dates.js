// Debug script to test different date formats with 1com API
import fetch from 'node-fetch';

const API_KEY = process.env.ONECOM_API_KEY;
const TENANT = process.env.ONECOM_TENANT;
const BASE_URL = process.env.ONECOM_BASE_URL || 'https://pbx6webserver.1com.co.il/pbx/proxyapi.php';

async function testDateFormat(dateStr, format) {
  const url = `${BASE_URL}?key=${API_KEY}&reqtype=INFO&info=CDRS&format=csv&tenant=${TENANT}&start=${dateStr}&end=${dateStr}`;
  
  console.log(`\n🔍 Testing ${format}: ${dateStr}`);
  console.log(`URL: ${url}`);
  
  try {
    const response = await fetch(url);
    const text = await response.text();
    
    if (text.includes('Too bad')) {
      console.log('❌ API Key error');
      return false;
    } else if (text.includes('No call logs found')) {
      console.log('✅ API working, no data for this date');
      return true;
    } else if (text.includes(',')) {
      console.log(`✅ Found data! ${text.split('\n').length - 1} lines`);
      return true;
    } else {
      console.log(`📝 Response: ${text.substring(0, 100)}...`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    return false;
  }
}

async function testDateFormats() {
  console.log('🧪 Testing different date formats with 1com API...\n');
  
  // Test different date formats for October 1st, 2025
  const dateFormats = [
    ['2025-10-01', 'YYYY-MM-DD'],
    ['01-10-2025', 'DD-MM-YYYY'],
    ['10/01/2025', 'MM/DD/YYYY'],
    ['01/10/2025', 'DD/MM/YYYY'],
    ['2025/10/01', 'YYYY/MM/DD'],
    ['1-10-2025', 'D-M-YYYY'],
    ['2025-10-1', 'YYYY-MM-D'],
  ];
  
  for (const [dateStr, format] of dateFormats) {
    await testDateFormat(dateStr, format);
  }
  
  console.log('\n📊 Date format testing complete!');
}

testDateFormats().catch(console.error);
