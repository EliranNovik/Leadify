// Immediate Supabase Test - No build required
// Copy and paste this into your browser console

console.log('🚀 Immediate Supabase Test...\n');

// Method 1: Try to access through React DevTools
const getSupabaseFromReact = () => {
  console.log('📋 Method 1: React DevTools Access');
  
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    console.log('✅ React DevTools available');
    
    // Try to find the root component
    const roots = document.querySelectorAll('[data-reactroot], #root');
    console.log('Found React roots:', roots.length);
    
    return null;
  } else {
    console.log('❌ React DevTools not available');
    return null;
  }
};

// Method 2: Try to access through localStorage
const getSupabaseFromStorage = () => {
  console.log('📋 Method 2: LocalStorage Access');
  
  try {
    const authData = localStorage.getItem('supabase.auth.token');
    if (authData) {
      console.log('✅ Found Supabase auth data in localStorage');
      const parsed = JSON.parse(authData);
      console.log('Auth data:', parsed);
      return parsed;
    } else {
      console.log('❌ No Supabase auth data in localStorage');
      return null;
    }
  } catch (error) {
    console.log('❌ Error reading localStorage:', error.message);
    return null;
  }
};

// Method 3: Try to create a new client
const createNewSupabaseClient = () => {
  console.log('📋 Method 3: Create New Client');
  
  try {
    // Look for environment variables in the page source
    const scripts = document.querySelectorAll('script');
    let supabaseUrl = null;
    let supabaseKey = null;
    
    scripts.forEach(script => {
      const content = script.textContent || '';
      if (content.includes('VITE_SUPABASE_URL')) {
        const urlMatch = content.match(/VITE_SUPABASE_URL["']?\s*[:=]\s*["']([^"']+)["']/);
        if (urlMatch) supabaseUrl = urlMatch[1];
      }
      if (content.includes('VITE_SUPABASE_ANON_KEY')) {
        const keyMatch = content.match(/VITE_SUPABASE_ANON_KEY["']?\s*[:=]\s*["']([^"']+)["']/);
        if (keyMatch) supabaseKey = keyMatch[1];
      }
    });
    
    if (supabaseUrl && supabaseKey) {
      console.log('✅ Found Supabase credentials');
      console.log('URL:', supabaseUrl);
      console.log('Key:', supabaseKey.substring(0, 20) + '...');
      
      // Try to create a client using the CDN version
      if (typeof window.createClient === 'undefined') {
        console.log('💡 Loading Supabase from CDN...');
        
        // Load Supabase from CDN
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@supabase/supabase-js@2';
        script.onload = () => {
          console.log('✅ Supabase loaded from CDN');
          testWithCDNClient(supabaseUrl, supabaseKey);
        };
        script.onerror = () => {
          console.log('❌ Failed to load Supabase from CDN');
        };
        document.head.appendChild(script);
      } else {
        testWithCDNClient(supabaseUrl, supabaseKey);
      }
    } else {
      console.log('❌ Could not find Supabase credentials');
      return null;
    }
  } catch (error) {
    console.log('❌ Error creating client:', error.message);
    return null;
  }
};

const testWithCDNClient = (url, key) => {
  try {
    const client = window.createClient(url, key);
    console.log('✅ Created Supabase client');
    
    // Test the client
    client.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.log('❌ Auth error:', error.message);
      } else if (data.session) {
        console.log('✅ User authenticated:', data.session.user.email);
        
        // Test database access
        testDatabaseAccess(client);
      } else {
        console.log('❌ User not authenticated');
      }
    });
  } catch (error) {
    console.log('❌ Error testing client:', error.message);
  }
};

const testDatabaseAccess = async (client) => {
  console.log('\n📋 Testing database access...');
  
  const tables = ['meeting_transcripts', 'meeting_summaries', 'meeting_questionnaires'];
  
  for (const table of tables) {
    try {
      const { data, error } = await client.from(table).select('count').limit(1);
      if (error) {
        console.log(`❌ ${table} - ${error.message}`);
      } else {
        console.log(`✅ ${table} - OK`);
      }
    } catch (err) {
      console.log(`❌ ${table} - ${err.message}`);
    }
  }
};

// Method 4: Check if the app is using a different approach
const checkAlternativeAccess = () => {
  console.log('📋 Method 4: Alternative Access Check');
  
  // Check for any global objects that might be Supabase
  const possibleNames = ['supabase', 'supabaseClient', 'client', 'db', 'database', 'sb'];
  const found = [];
  
  possibleNames.forEach(name => {
    if (window[name]) {
      found.push(name);
      console.log(`✅ Found: window.${name}`);
    }
  });
  
  if (found.length === 0) {
    console.log('❌ No alternative Supabase objects found');
  }
  
  return found;
};

// Run all methods
const runAllMethods = () => {
  console.log('🔍 Running all access methods...\n');
  
  getSupabaseFromReact();
  getSupabaseFromStorage();
  createNewSupabaseClient();
  checkAlternativeAccess();
  
  console.log('\n💡 If none of these work, try:');
  console.log('1. Restart your development server (npm run dev)');
  console.log('2. Clear browser cache and refresh');
  console.log('3. Check the browser console for any errors');
};

// Run the test
runAllMethods();
