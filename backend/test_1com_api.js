#!/usr/bin/env node

// Test script to debug 1com API calls
const fetch = require('node-fetch');

async function test1comAPI() {
  const apiKey = 'Lufbp2hYHpLrwMCZ';
  const tenant = 'decker';
  const callId = 'pbx24-1740387313.12222606';
  
  console.log('🧪 Testing 1com API with different parameters...\n');
  
  // Test 1: info=recording
  const url1 = `https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=${apiKey}&reqtype=INFO&info=recording&id=${callId}&tenant=${tenant}`;
  console.log('🔍 Test 1 - info=recording:');
  console.log('URL:', url1.replace(apiKey, '***'));
  
  try {
    const response1 = await fetch(url1, {
      method: 'GET',
      headers: {
        'User-Agent': 'Leadify-CRM/1.0',
        'Accept': 'audio/*,*/*'
      }
    });
    
    console.log('Status:', response1.status);
    console.log('Headers:', Object.fromEntries(response1.headers.entries()));
    
    const contentType1 = response1.headers.get('content-type') || '';
    console.log('Content-Type:', contentType1);
    
    if (contentType1.includes('text/html')) {
      const htmlContent = await response1.text();
      console.log('HTML Response (first 500 chars):', htmlContent.substring(0, 500));
    } else {
      console.log('Response size:', response1.headers.get('content-length') || 'unknown');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // Test 2: info=playrecording
  const url2 = `https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=${apiKey}&reqtype=INFO&info=playrecording&id=${callId}&tenant=${tenant}`;
  console.log('🔍 Test 2 - info=playrecording:');
  console.log('URL:', url2.replace(apiKey, '***'));
  
  try {
    const response2 = await fetch(url2, {
      method: 'GET',
      headers: {
        'User-Agent': 'Leadify-CRM/1.0',
        'Accept': 'audio/*,*/*'
      }
    });
    
    console.log('Status:', response2.status);
    console.log('Headers:', Object.fromEntries(response2.headers.entries()));
    
    const contentType2 = response2.headers.get('content-type') || '';
    console.log('Content-Type:', contentType2);
    
    if (contentType2.includes('text/html')) {
      const htmlContent = await response2.text();
      console.log('HTML Response (first 500 chars):', htmlContent.substring(0, 500));
    } else {
      console.log('Response size:', response2.headers.get('content-length') || 'unknown');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // Test 3: Test with a different call ID format (from documentation example)
  const docCallId = 'srv02-1531779475.48';
  const url3 = `https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=${apiKey}&reqtype=INFO&info=recording&id=${docCallId}&tenant=${tenant}`;
  console.log('🔍 Test 3 - Using documentation example call ID:');
  console.log('URL:', url3.replace(apiKey, '***'));
  
  try {
    const response3 = await fetch(url3, {
      method: 'GET',
      headers: {
        'User-Agent': 'Leadify-CRM/1.0',
        'Accept': 'audio/*,*/*'
      }
    });
    
    console.log('Status:', response3.status);
    console.log('Headers:', Object.fromEntries(response3.headers.entries()));
    
    const contentType3 = response3.headers.get('content-type') || '';
    console.log('Content-Type:', contentType3);
    
    if (contentType3.includes('text/html')) {
      const htmlContent = await response3.text();
      console.log('HTML Response (first 500 chars):', htmlContent.substring(0, 500));
    } else {
      console.log('Response size:', response3.headers.get('content-length') || 'unknown');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test1comAPI().catch(console.error);
