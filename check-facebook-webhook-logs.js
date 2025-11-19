/**
 * Script to check access_logs table for Facebook webhook requests
 * Run with: node check-facebook-webhook-logs.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFacebookWebhookLogs() {
  try {
    console.log('🔍 Checking access_logs for Facebook webhook requests...\n');

    // Get all requests to /hook/facebook in the last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: logs, error } = await supabase
      .from('access_logs')
      .select('*')
      .eq('endpoint', '/api/hook/facebook')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('❌ Error fetching logs:', error);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log('⚠️  No Facebook webhook requests found in the last 24 hours.');
      console.log('   This means Facebook is NOT sending webhooks to your server.\n');
      console.log('   Check:');
      console.log('   1. Is the webhook URL configured correctly in Facebook?');
      console.log('   2. Is the webhook subscribed to "leadgen" events?');
      console.log('   3. Is the webhook active/enabled in Facebook?');
      console.log('   4. Check Facebook webhook logs in Meta Business Suite\n');
    } else {
      console.log(`✅ Found ${logs.length} Facebook webhook request(s) in the last 24 hours:\n`);
      
      logs.forEach((log, index) => {
        console.log(`--- Request ${index + 1} ---`);
        console.log(`Time: ${log.created_at}`);
        console.log(`Method: ${log.request_method}`);
        console.log(`Response Code: ${log.response_code}`);
        console.log(`IP: ${log.ip_address}`);
        console.log(`User-Agent: ${log.user_agent}`);
        console.log(`Processing Time: ${log.processing_time_ms}ms`);
        
        if (log.request_body) {
          try {
            const body = JSON.parse(log.request_body);
            console.log(`Request Body (first 500 chars):`, JSON.stringify(body, null, 2).substring(0, 500));
          } catch (e) {
            console.log(`Request Body (raw):`, log.request_body.substring(0, 500));
          }
        }
        
        if (log.response_body) {
          try {
            const response = JSON.parse(log.response_body);
            console.log(`Response:`, JSON.stringify(response, null, 2));
          } catch (e) {
            console.log(`Response (raw):`, log.response_body.substring(0, 500));
          }
        }
        
        console.log('');
      });
    }

    // Also check for any requests to /api/hook/* in general
    const { data: allWebhookLogs, error: allError } = await supabase
      .from('access_logs')
      .select('endpoint, request_method, response_code, created_at')
      .like('endpoint', '/api/hook/%')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!allError && allWebhookLogs && allWebhookLogs.length > 0) {
      console.log(`\n📊 All webhook requests in last 24h (${allWebhookLogs.length} total):`);
      allWebhookLogs.forEach(log => {
        console.log(`  ${log.created_at} - ${log.request_method} ${log.endpoint} - ${log.response_code}`);
      });
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkFacebookWebhookLogs();

