// Script to get the correct anon key
console.log('🔧 Getting Supabase anon key...');

// Check if supabase is available
if (typeof supabase !== 'undefined') {
  console.log('✅ Supabase client found');
  console.log('🔑 Anon key:', supabase.supabaseKey);
  console.log('🌐 URL:', supabase.supabaseUrl);
} else {
  console.log('❌ Supabase client not available');
  console.log('💡 Make sure you\'re running this in the browser console');
}

console.log('�� Test completed');
