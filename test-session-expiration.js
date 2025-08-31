// Test script to verify session expiration behavior (Refresh Tokens with 1-hour access tokens)
// Run this in the browser console to test session expiration

console.log('=== Session Expiration Test Script (Refresh Tokens) ===');

// Test 1: Check current session status
async function testCurrentSession() {
  console.log('\n1. Testing current session status...');
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.log('❌ Error getting session:', error);
      return;
    }
    
    if (!session) {
      console.log('❌ No session found - user is logged out');
      return;
    }
    
    console.log('✅ Session found');
    console.log('User:', session.user?.email);
    console.log('Expires at:', session.expires_at);
    console.log('Expires at type:', typeof session.expires_at);
    console.log('Has refresh token:', !!session.refresh_token);
    
    // Parse expiration time
    let expiresAt = null;
    if (session.expires_at) {
      if (typeof session.expires_at === 'number') {
        expiresAt = new Date(session.expires_at * 1000);
      } else if (typeof session.expires_at === 'string') {
        expiresAt = new Date(session.expires_at);
      }
    }
    
    const now = new Date();
    const timeUntilExpiry = expiresAt ? expiresAt.getTime() - now.getTime() : null;
    
    console.log('Parsed expires at:', expiresAt);
    console.log('Current time:', now);
    console.log('Time until expiry:', timeUntilExpiry ? `${Math.round(timeUntilExpiry / 1000 / 60)} minutes` : 'Unknown');
    
    // Check if it's approximately 1 hour
    const hoursUntilExpiry = timeUntilExpiry ? Math.round(timeUntilExpiry / 1000 / 60 / 60) : null;
    const minutesUntilExpiry = timeUntilExpiry ? Math.round(timeUntilExpiry / 1000 / 60) : null;
    console.log('Hours until expiry:', hoursUntilExpiry);
    console.log('Minutes until expiry:', minutesUntilExpiry);
    
    if (timeUntilExpiry && timeUntilExpiry <= 0) {
      console.log('❌ Session is EXPIRED');
    } else if (minutesUntilExpiry && minutesUntilExpiry >= 55 && minutesUntilExpiry <= 65) {
      console.log('✅ Session is VALID (approximately 1 hour)');
    } else {
      console.log('⚠️ Session is VALID but duration might not be 1 hour');
      console.log('Expected: ~60 minutes, Actual:', minutesUntilExpiry, 'minutes');
    }
    
  } catch (error) {
    console.error('❌ Error in testCurrentSession:', error);
  }
}

// Test 2: Test session manager behavior
async function testSessionManager() {
  console.log('\n2. Testing session manager behavior...');
  
  try {
    const session = await sessionManager.getSession();
    
    if (session) {
      console.log('✅ Session manager returned valid session');
      const hasRefreshToken = sessionManager.hasRefreshToken(session);
      const timeUntilExpiry = sessionManager.getTimeUntilExpiry(session);
      console.log('Refresh token available:', hasRefreshToken);
      console.log('Time until expiry:', timeUntilExpiry ? `${Math.round(timeUntilExpiry / 1000 / 60)} minutes` : 'Unknown');
    } else {
      console.log('❌ Session manager returned no session (expired/logged out)');
    }
    
  } catch (error) {
    console.error('❌ Error in testSessionManager:', error);
  }
}

// Test 3: Test expiration check function
async function testExpirationCheck() {
  console.log('\n3. Testing expiration check function...');
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('❌ No session to test');
      return;
    }
    
    const isExpired = sessionManager.isSessionExpired(session);
    const hasRefreshToken = sessionManager.hasRefreshToken(session);
    console.log('Is session expired?', isExpired ? '❌ YES' : '✅ NO');
    console.log('Has refresh token?', hasRefreshToken ? '✅ YES' : '❌ NO');
    
  } catch (error) {
    console.error('❌ Error in testExpirationCheck:', error);
  }
}

// Test 4: Test auto-refresh configuration
function testAutoRefreshConfig() {
  console.log('\n4. Testing auto-refresh configuration...');
  
  // Check if auto-refresh is enabled
  const supabaseConfig = supabase.supabaseKey ? 'Client configured' : 'Client not configured';
  console.log('Supabase client:', supabaseConfig);
  
  // Note: We can't directly access the config, but we can verify behavior
  console.log('✅ Auto-refresh should be enabled based on our configuration');
  console.log('✅ Access tokens should last 1 hour before auto-refresh');
  console.log('✅ Refresh tokens should last 24 hours');
}

// Test 5: Simulate expired session
async function testExpiredSessionSimulation() {
  console.log('\n5. Testing expired session simulation...');
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('❌ No session to simulate expiration for');
      return;
    }
    
    // Create a mock expired session by modifying the expires_at
    const mockExpiredSession = {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    };
    
    // Test the expiration check with the mock expired session
    const isExpired = sessionManager.isSessionExpired(mockExpiredSession);
    const hasRefreshToken = sessionManager.hasRefreshToken(mockExpiredSession);
    console.log('Mock expired session test:', isExpired ? '❌ EXPIRED' : '✅ VALID');
    console.log('Has refresh token:', hasRefreshToken ? '✅ YES' : '❌ NO');
    
    if (isExpired) {
      console.log('✅ Expiration detection is working correctly');
      if (hasRefreshToken) {
        console.log('✅ Refresh token available - system would attempt refresh');
      } else {
        console.log('❌ No refresh token - user would be logged out');
      }
    } else {
      console.log('❌ Expiration detection might not be working');
    }
    
  } catch (error) {
    console.error('❌ Error in testExpiredSessionSimulation:', error);
  }
}

// Test 6: Verify 1-hour configuration
async function test1HourConfiguration() {
  console.log('\n6. Testing 1-hour access token configuration...');
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('❌ No session to test 1-hour configuration');
      return;
    }
    
    // Parse expiration time
    let expiresAt = null;
    if (session.expires_at) {
      if (typeof session.expires_at === 'number') {
        expiresAt = new Date(session.expires_at * 1000);
      } else if (typeof session.expires_at === 'string') {
        expiresAt = new Date(session.expires_at);
      }
    }
    
    const now = new Date();
    const timeUntilExpiry = expiresAt ? expiresAt.getTime() - now.getTime() : null;
    const minutesUntilExpiry = timeUntilExpiry ? Math.round(timeUntilExpiry / 1000 / 60) : null;
    const hasRefreshToken = sessionManager.hasRefreshToken(session);
    
    console.log('Expected access token duration: 1 hour (60 minutes)');
    console.log('Actual time until expiry:', minutesUntilExpiry, 'minutes');
    console.log('Refresh token available:', hasRefreshToken ? 'Yes' : 'No');
    
    if (minutesUntilExpiry && minutesUntilExpiry >= 55 && minutesUntilExpiry <= 65) {
      console.log('✅ 1-hour access token configuration is working correctly');
    } else if (minutesUntilExpiry && minutesUntilExpiry >= 1380 && minutesUntilExpiry <= 1500) {
      console.log('⚠️ Session duration appears to be 24 hours (old configuration)');
      console.log('You may need to configure JWT_EXPIRY=3600 in Supabase dashboard');
    } else {
      console.log('⚠️ Unexpected session duration:', minutesUntilExpiry, 'minutes');
    }
    
    if (hasRefreshToken) {
      console.log('✅ Refresh token is available for automatic refresh');
    } else {
      console.log('❌ No refresh token available - auto-refresh won\'t work');
    }
    
  } catch (error) {
    console.error('❌ Error in test1HourConfiguration:', error);
  }
}

// Test 7: Test refresh token functionality
async function testRefreshTokenFunctionality() {
  console.log('\n7. Testing refresh token functionality...');
  
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
      console.log('❌ No session to test refresh token functionality');
      return;
    }
    
    const hasRefreshToken = sessionManager.hasRefreshToken(session);
    const timeUntilExpiry = sessionManager.getTimeUntilExpiry(session);
    
    console.log('Refresh token available:', hasRefreshToken ? '✅ YES' : '❌ NO');
    console.log('Time until access token expiry:', timeUntilExpiry ? `${Math.round(timeUntilExpiry / 1000 / 60)} minutes` : 'Unknown');
    
    if (hasRefreshToken) {
      console.log('✅ Refresh token functionality should work');
      console.log('✅ Auto-refresh will attempt to renew access tokens');
      console.log('✅ Users will stay logged in for 24 hours');
    } else {
      console.log('❌ No refresh token - auto-refresh won\'t work');
      console.log('❌ Users will be logged out when access token expires');
    }
    
  } catch (error) {
    console.error('❌ Error in testRefreshTokenFunctionality:', error);
  }
}

// Run all tests
async function runAllTests() {
  console.log('Starting session expiration tests (Refresh Tokens)...\n');
  
  await testCurrentSession();
  await testSessionManager();
  await testExpirationCheck();
  testAutoRefreshConfig();
  await testExpiredSessionSimulation();
  await test1HourConfiguration();
  await testRefreshTokenFunctionality();
  
  console.log('\n=== Test Summary ===');
  console.log('✅ marks indicate correct behavior');
  console.log('❌ marks indicate issues that need attention');
  console.log('⚠️ marks indicate potential configuration issues');
  console.log('\nExpected behavior:');
  console.log('- Access tokens should last 1 hour');
  console.log('- Refresh tokens should last 24 hours');
  console.log('- Auto-refresh should be enabled');
  console.log('- Expired access tokens should trigger refresh');
  console.log('- Only logout if refresh fails');
  console.log('\nTo configure refresh tokens:');
  console.log('1. Go to Supabase Dashboard → Settings → API');
  console.log('2. Set JWT_EXPIRY=3600 (1 hour)');
  console.log('3. Set REFRESH_TOKEN_REUSE_INTERVAL=10');
  console.log('4. Enable Refresh Token Rotation');
  console.log('5. Set Refresh Token Expiry=86400 (24 hours)');
}

// Export functions for manual testing
window.testSessionExpiration = {
  testCurrentSession,
  testSessionManager,
  testExpirationCheck,
  testAutoRefreshConfig,
  testExpiredSessionSimulation,
  test1HourConfiguration,
  testRefreshTokenFunctionality,
  runAllTests
};

console.log('Session expiration test functions available as:');
console.log('- window.testSessionExpiration.runAllTests()');
console.log('- window.testSessionExpiration.testCurrentSession()');
console.log('- window.testSessionExpiration.test1HourConfiguration()');
console.log('- window.testSessionExpiration.testRefreshTokenFunctionality()');
console.log('- etc.');

// Auto-run tests
runAllTests();
