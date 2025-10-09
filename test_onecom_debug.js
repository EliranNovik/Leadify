// Test 1com sync with debug output
import dotenv from 'dotenv';
import OneComSyncService from './backend/src/services/onecomSyncService.js';

// Load environment variables
dotenv.config();

async function testOneComSync() {
  console.log('🧪 Testing 1com sync with debug output...\n');
  
  const onecomSync = new OneComSyncService();
  
  try {
    // Test connection first
    console.log('🔍 Testing connection...');
    const isConnected = await onecomSync.testConnection();
    console.log('Connection result:', isConnected);
    
    if (!isConnected) {
      console.log('❌ Connection failed, stopping test');
      return;
    }
    
    // Test sync for October 1st, 2025
    console.log('\n🔍 Testing sync for 2025-10-01...');
    const result = await onecomSync.syncCallLogs('2025-10-01', '2025-10-01');
    
    console.log('\n📊 Sync result:', result);
    
  } catch (error) {
    console.error('❌ Test error:', error);
  }
}

testOneComSync().catch(console.error);
