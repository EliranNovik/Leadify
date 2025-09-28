const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function testRevenueCalculation() {
  try {
    console.log('🔍 Testing monthly revenue calculation for September 2025...');
    
    // Get the date range for September 2025
    const year = 2025;
    const month = 9;
    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];
    
    console.log('📅 Date range:', { startDate, endDate });
    
    // Check if there are any leads in the date range
    const { data: allLeads, error: allLeadsError } = await supabase
      .from('leads_lead')
      .select('id, total, currency_id, cdate, status')
      .gte('cdate', startDate)
      .lte('cdate', endDate);
    
    if (allLeadsError) {
      console.error('❌ Error fetching all leads:', allLeadsError);
      return;
    }
    
    console.log(`📊 Total leads in date range: ${allLeads?.length || 0}`);
    
    // Check signed leads specifically
    const { data: signedLeads, error: signedLeadsError } = await supabase
      .from('leads_lead')
      .select('id, total, currency_id, cdate, status')
      .gte('cdate', startDate)
      .lte('cdate', endDate)
      .eq('status', 60);
    
    if (signedLeadsError) {
      console.error('❌ Error fetching signed leads:', signedLeadsError);
      return;
    }
    
    console.log(`✅ Signed leads (status 60): ${signedLeads?.length || 0}`);
    
    if (signedLeads && signedLeads.length > 0) {
      console.log('📋 Sample signed leads:', signedLeads.slice(0, 3));
      
      const totalRevenue = signedLeads.reduce((sum, lead) => {
        return sum + (lead.total || 0);
      }, 0);
      
      console.log(`💰 Total revenue: ₪${totalRevenue.toLocaleString()}`);
    } else {
      console.log('⚠️ No signed leads found for September 2025');
      
      // Let's check what statuses exist
      const { data: statusCounts, error: statusError } = await supabase
        .from('leads_lead')
        .select('status')
        .gte('cdate', startDate)
        .lte('cdate', endDate);
      
      if (!statusError && statusCounts) {
        const statusMap = {};
        statusCounts.forEach(lead => {
          statusMap[lead.status] = (statusMap[lead.status] || 0) + 1;
        });
        console.log('📊 Status distribution:', statusMap);
      }
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testRevenueCalculation();
