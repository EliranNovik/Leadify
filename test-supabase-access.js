// Test script to access Supabase client from browser console
// Copy and paste this into your browser console

console.log('🔍 Testing Supabase Access...\n');

// Method 1: Check if supabase is available globally
const checkGlobalSupabase = () => {
  console.log('📋 Method 1: Global Supabase Check');
  
  if (typeof supabase !== 'undefined') {
    console.log('✅ Supabase available globally');
    return supabase;
  } else {
    console.log('❌ Supabase not available globally');
    return null;
  }
};

// Method 2: Check React DevTools for supabase instance
const checkReactSupabase = () => {
  console.log('📋 Method 2: React DevTools Check');
  
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('✅ React DevTools available');
    console.log('💡 Try accessing supabase through React components');
  } else {
    console.log('❌ React DevTools not available');
  }
  
  return null;
};

// Method 3: Check for any supabase-related objects
const checkForSupabaseObjects = () => {
  console.log('📋 Method 3: Search for Supabase Objects');
  
  const possibleNames = [
    'supabase',
    'supabaseClient',
    'client',
    'db',
    'database'
  ];
  
  const found = [];
  possibleNames.forEach(name => {
    if (window[name]) {
      found.push(name);
      console.log(`✅ Found: window.${name}`);
    }
  });
  
  if (found.length === 0) {
    console.log('❌ No Supabase objects found in global scope');
  }
  
  return found;
};

// Method 4: Try to access through document
const checkDocumentForSupabase = () => {
  console.log('📋 Method 4: Document Search');
  
  // Look for any script tags that might contain supabase
  const scripts = document.querySelectorAll('script');
  let found = false;
  
  scripts.forEach((script, index) => {
    if (script.textContent && script.textContent.includes('supabase')) {
      console.log(`✅ Found supabase in script ${index}`);
      found = true;
    }
  });
  
  if (!found) {
    console.log('❌ No supabase references found in scripts');
  }
  
  return found;
};

// Method 5: Check for environment variables
const checkEnvironment = () => {
  console.log('📋 Method 5: Environment Check');
  
  // Check if we can see any environment variables
  const envCheck = {
    hasVite: typeof import !== 'undefined',
    hasNode: typeof process !== 'undefined',
    hasWindow: typeof window !== 'undefined'
  };
  
  console.log('Environment:', envCheck);
  
  // Try to access Vite environment variables
  if (envCheck.hasVite) {
    try {
      console.log('💡 Try: import.meta.env.VITE_SUPABASE_URL');
    } catch (e) {
      console.log('❌ Cannot access Vite env variables');
    }
  }
  
  return envCheck;
};

// Main test function
const testSupabaseAccess = async () => {
  console.log('🚀 Testing Supabase Access Methods...\n');
  
  // Try all methods
  const globalSupabase = checkGlobalSupabase();
  checkReactSupabase();
  const foundObjects = checkForSupabaseObjects();
  const foundInScripts = checkDocumentForSupabase();
  const envInfo = checkEnvironment();
  
  console.log('\n📋 Summary:');
  
  if (globalSupabase) {
    console.log('✅ Supabase is available globally!');
    console.log('💡 You can now run the test scripts.');
    return globalSupabase;
  } else if (foundObjects.length > 0) {
    console.log(`✅ Found Supabase objects: ${foundObjects.join(', ')}`);
    console.log('💡 Try using one of these instead of "supabase"');
    return window[foundObjects[0]];
  } else {
    console.log('❌ Supabase not accessible from console');
    console.log('\n💡 Solutions:');
    console.log('1. Make sure you\'re logged into the application');
    console.log('2. Try accessing from a React component context');
    console.log('3. Check if the app is fully loaded');
    console.log('4. Try refreshing the page');
    
    return null;
  }
};

// Run the test
testSupabaseAccess().then(client => {
  if (client) {
    console.log('\n🎉 Success! You can now use the client for testing.');
    console.log('💡 Example: client.auth.getSession()');
  }
});
