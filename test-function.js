// Test script to call the Edge Function
const SUPABASE_URL = 'https://your-project-ref.supabase.co'; // Replace with your actual URL
const SUPABASE_ANON_KEY = 'your-anon-key'; // Replace with your actual key

async function testFunction() {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/list-onedrive-files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        leadNumber: '12345'
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const data = await response.text();
    console.log('Response body:', data);
    
    if (response.ok) {
      const jsonData = JSON.parse(data);
      console.log('Parsed response:', jsonData);
    }
  } catch (error) {
    console.error('Error calling function:', error);
  }
}

testFunction(); 