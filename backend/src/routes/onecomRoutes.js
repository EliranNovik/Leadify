const express = require('express');
const router = express.Router();
const OneComSyncService = require('../services/onecomSyncService');
const supabase = require('../config/supabase');

const onecomSync = new OneComSyncService();

/**
 * POST /api/onecom/sync
 * Sync call logs from 1com to database
 */
router.post('/sync', async (req, res) => {
  try {
    const { startDate, endDate, extensions } = req.body;

    // Validate required parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({
        success: false,
        error: 'Dates must be in YYYY-MM-DD format'
      });
    }

    // Validate date range (max 30 days)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return res.status(400).json({
        success: false,
        error: 'Date range cannot exceed 30 days'
      });
    }

    console.log(`🔄 Starting sync request: ${startDate} to ${endDate}${extensions ? ` for extensions: ${extensions}` : ''}`);

    // Perform sync
    const result = await onecomSync.syncCallLogs(startDate, endDate, extensions);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/test
 * Test 1com API connection
 */
router.get('/test', async (req, res) => {
  try {
    const isConnected = await onecomSync.testConnection();
    
    res.json({
      success: isConnected,
      message: isConnected ? 'Connection successful' : 'Connection failed',
      connected: isConnected
    });
  } catch (error) {
    console.error('❌ Error testing 1com connection:', error);
    res.status(500).json({
      success: false,
      error: 'Connection test failed',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/stats
 * Get sync statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await onecomSync.getSyncStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error getting sync stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sync statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/extensions
 * Get available extensions from 1com
 */
router.get('/extensions', async (req, res) => {
  try {
    const extensions = await onecomSync.getExtensions();
    
    res.json({
      success: true,
      data: extensions
    });
  } catch (error) {
    console.error('❌ Error getting extensions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get extensions',
      message: error.message
    });
  }
});

/**
 * POST /api/onecom/sync/last-3-days
 * Quick sync for the last 3 days
 */
router.post('/sync/last-3-days', async (req, res) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 3);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    console.log(`🔄 Quick sync for last 3 days: ${startDateStr} to ${endDateStr}`);

    const result = await onecomSync.syncCallLogs(startDateStr, endDateStr);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          dateRange: `${startDateStr} to ${endDateStr}`,
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in quick sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/onecom/sync/today
 * Quick sync for today
 */
router.post('/sync/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    console.log(`🔄 Quick sync for today: ${today}`);

    const result = await onecomSync.syncCallLogs(today, today);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        data: {
          dateRange: today,
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: result.message
      });
    }

  } catch (error) {
    console.error('❌ Error in today sync route:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/onecom/recording/:uniqueId
 * Fetch recording data for a specific call
 */
router.get('/recording/:uniqueId', async (req, res) => {
  try {
    const { uniqueId } = req.params;

    if (!uniqueId) {
      return res.status(400).json({
        success: false,
        error: 'uniqueId is required'
      });
    }

    console.log(`🎵 Fetching recording for ${uniqueId}`);

    const recordingData = await onecomSync.fetchRecordingData(uniqueId);

    if (recordingData && recordingData.available) {
      res.json({
        success: true,
        data: recordingData
      });
    } else {
      res.json({
        success: false,
        message: 'No recording available for this call',
        data: null
      });
    }

  } catch (error) {
    console.error('❌ Error fetching recording:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recording',
      message: error.message
    });
  }
});

/**
 * POST /api/onecom/webhook
 * Webhook endpoint to receive call logs from OneCom automatically
 * OneCom will POST call log data to this endpoint when calls are completed
 */
router.post('/webhook', async (req, res) => {
  try {
    // Send immediate response to OneCom (202 Accepted)
    // This is important so OneCom doesn't retry
    res.status(202).json({
      success: true,
      message: 'Webhook received'
    });

    // Process the webhook data asynchronously
    // Note: OneCom webhook format may vary - adjust based on actual format
    const webhookData = req.body;
    
    console.log('='.repeat(80));
    console.log('🔔🔔🔔 ONECOM WEBHOOK RECEIVED 🔔🔔🔔');
    console.log('🔔 Time:', new Date().toISOString());
    console.log('🔔 Request IP:', req.ip || req.connection.remoteAddress);
    console.log('🔔 User-Agent:', req.get('User-Agent'));
    console.log('🔔 Webhook data:', JSON.stringify(webhookData, null, 2));
    console.log('='.repeat(80));

    // Handle both single call log and batch (array) formats
    if (Array.isArray(webhookData)) {
      // Batch processing
      const result = await onecomSync.processWebhookCallLogs(webhookData);
      
      if (result.success) {
        console.log(`✅ Webhook batch processed: ${result.synced} synced, ${result.skipped} skipped`);
        if (result.errors && result.errors.length > 0) {
          console.error(`❌ Webhook batch errors:`, result.errors);
        }
      } else {
        console.error(`❌ Webhook batch processing failed:`, result.error);
      }
    } else if (webhookData.uniqueid || webhookData.call_id) {
      // Single call log with full data
      const result = await onecomSync.processWebhookCallLog(webhookData);
      
      if (result.success) {
        if (result.skipped) {
          console.log(`⏭️ Webhook: Call log already exists (${result.uniqueid || 'unknown'})`);
        } else {
          console.log(`✅ Webhook: Call log saved successfully (${result.uniqueid || 'unknown'})`);
        }
      } else {
        console.error(`❌ Webhook processing failed:`, result.error);
      }
    } else if (webhookData.phone || webhookData.extension) {
      // Outgoing call notification - just extension/phone number
      // Fetch recent call logs for this extension to get full call data
      const extension = String(webhookData.phone || webhookData.extension).trim();
      console.log(`📞 Webhook: Received outgoing call notification for extension/phone: ${extension}`);
      console.log(`📞 Fetching recent call logs for extension ${extension}...`);
      
      // Fetch call logs from last hour to catch the call
      // Use today's date as both start and end to get all calls from today
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const startDate = oneHourAgo.toISOString().split('T')[0];
      const endDate = now.toISOString().split('T')[0];
      
      console.log(`📞 Syncing call logs from ${startDate} to ${endDate} for extension ${extension}`);
      
      // syncCallLogs expects extensions as a comma-separated string
      const syncResult = await onecomSync.syncCallLogs(startDate, endDate, extension);
      
      if (syncResult.success) {
        console.log(`✅ Webhook: Synced call logs for extension ${extension}`);
        console.log(`   - New records: ${syncResult.synced || 0}`);
        console.log(`   - Skipped (existing): ${syncResult.skipped || 0}`);
        if (syncResult.errors && syncResult.errors.length > 0) {
          console.error(`   - Errors: ${syncResult.errors.length}`);
        }
      } else {
        console.error(`❌ Webhook: Failed to sync call logs for extension ${extension}:`, syncResult.error);
      }
    } else if (webhookData.data && Array.isArray(webhookData.data)) {
      // Nested data array format
      const result = await onecomSync.processWebhookCallLogs(webhookData.data);
      
      if (result.success) {
        console.log(`✅ Webhook nested batch processed: ${result.synced} synced, ${result.skipped} skipped`);
      } else {
        console.error(`❌ Webhook nested batch processing failed:`, result.error);
      }
    } else {
      console.warn('⚠️ Webhook: Unknown data format, could not process:', JSON.stringify(webhookData, null, 2));
      console.warn('⚠️ Expected format: {uniqueid/call_id}, {phone/extension}, or array of call logs');
    }

  } catch (error) {
    // Don't send error response since we already sent 202
    // Just log it for debugging
    console.error('❌ Error processing OneCom webhook:', error);
    console.error('Error stack:', error.stack);
  }
});

/**
 * GET /api/onecom/webhook
 * Webhook verification endpoint (for OneCom webhook setup)
 * Some webhook systems require a GET endpoint for verification
 */
router.get('/webhook', async (req, res) => {
  try {
    // Use deployed backend URL from environment variable, or construct from request
    const deployedBackendUrl = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || 'https://leadify-crm-backend.onrender.com';
    const webhookUrl = `${deployedBackendUrl}/api/onecom/webhook`;
    
    res.json({
      success: true,
      message: 'OneCom webhook endpoint is active',
      webhookUrl: webhookUrl,
      instructions: [
        'Configure this URL in your OneCom PBX webhook settings',
        'Set webhook type to: POST',
        'Content-Type: application/json',
        'The endpoint will automatically save call logs to the database'
      ]
    });
  } catch (error) {
    console.error('❌ Error in webhook verification:', error);
    res.status(500).json({
      success: false,
      error: 'Webhook verification failed',
      message: error.message
    });
  }
});

/**
 * GET /api/cti/lookup
 * Lookup lead and contact information by phone number (for CTI popup)
 * Returns ALL matching leads with proper source, stage, category, and scheduler mappings
 */
router.get('/lookup', async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'phone parameter is required'
      });
    }

    console.log(`📞 CTI lookup request for phone: ${phone}`);

    // Normalize phone and create variations
    const normalizedPhone = onecomSync.normalizePhone(phone);
    const phoneVariations = [
      normalizedPhone,
      normalizedPhone.replace(/^972/, ''),
      normalizedPhone.replace(/^00972/, ''),
      normalizedPhone.replace(/^0/, ''),
      `972${normalizedPhone.replace(/^972/, '')}`,
      `0${normalizedPhone.replace(/^0/, '')}`,
    ].filter(Boolean);

    const normalizedSet = new Set(
      phoneVariations.map(v => onecomSync.normalizePhone(v))
    );
    normalizedSet.add(normalizedPhone);

    const last8Digits = normalizedPhone.length >= 8 ? normalizedPhone.slice(-8) : null;

    // Find all matching leads - both new and legacy
    const matchingLeadIds = new Set();
    const matchingClientIds = new Set();

    // 1. Find leads via direct phone/mobile match in leads table (new leads)
    if (last8Digits) {
      const { data: newLeadsDirect } = await supabase
        .from('leads')
        .select('id')
        .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%`);
      
      if (newLeadsDirect) {
        newLeadsDirect.forEach(lead => matchingClientIds.add(lead.id));
      }
    }

    // 2. Find leads via direct phone/mobile match in leads_lead table (legacy leads)
    if (last8Digits) {
      const { data: legacyLeadsDirect } = await supabase
        .from('leads_lead')
        .select('id')
        .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`);
      
      if (legacyLeadsDirect) {
        legacyLeadsDirect.forEach(lead => matchingLeadIds.add(lead.id));
      }
    }

    // 3. Find leads via contacts
    const contactSelectColumns = `
      id,
      lead_leadcontact (
        lead_id,
        newlead_id
      )
    `;

    const { data: phoneContacts } = await supabase
      .from('leads_contact')
      .select(contactSelectColumns)
      .in('phone', phoneVariations)
      .limit(100);

    const { data: mobileContacts } = await supabase
      .from('leads_contact')
      .select(contactSelectColumns)
      .in('mobile', phoneVariations)
      .limit(100);

    const allContacts = [...(phoneContacts || []), ...(mobileContacts || [])];
    const uniqueContacts = Array.from(new Map(allContacts.map(c => [c.id, c])).values());

    for (const contact of uniqueContacts) {
      if (contact.lead_leadcontact) {
        for (const link of Array.isArray(contact.lead_leadcontact) ? contact.lead_leadcontact : [contact.lead_leadcontact]) {
          if (link.newlead_id) {
            matchingClientIds.add(link.newlead_id);
          }
          if (link.lead_id) {
            matchingLeadIds.add(link.lead_id);
          }
        }
      }
    }

    // If no matches found via contacts, try last 8 digits on contacts
    if (matchingClientIds.size === 0 && matchingLeadIds.size === 0 && last8Digits) {
      const { data: contactsByLast8 } = await supabase
        .from('leads_contact')
        .select(contactSelectColumns)
        .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`)
        .limit(100);

      if (contactsByLast8) {
        for (const contact of contactsByLast8) {
          if (contact.lead_leadcontact) {
            for (const link of Array.isArray(contact.lead_leadcontact) ? contact.lead_leadcontact : [contact.lead_leadcontact]) {
              if (link.newlead_id) {
                matchingClientIds.add(link.newlead_id);
              }
              if (link.lead_id) {
                matchingLeadIds.add(link.lead_id);
              }
            }
          }
        }
      }
    }

    // Fetch contact information
    let contactData = null;
    const { data: allContactsForPhone } = await supabase
      .from('leads_contact')
      .select('id, name, phone, mobile, email, additional_phones')
      .in('phone', phoneVariations)
      .limit(1);
    
    if (allContactsForPhone && allContactsForPhone.length > 0) {
      contactData = allContactsForPhone[0];
    } else {
      const { data: allContactsForMobile } = await supabase
        .from('leads_contact')
        .select('id, name, phone, mobile, email, additional_phones')
        .in('mobile', phoneVariations)
        .limit(1);
      
      if (allContactsForMobile && allContactsForMobile.length > 0) {
        contactData = allContactsForMobile[0];
      }
    }

    // If no matches found
    if (matchingClientIds.size === 0 && matchingLeadIds.size === 0) {
      return res.json({
        success: true,
        found: false,
        phone: phone,
        message: 'No lead found for this phone number'
      });
    }

    // Fetch all matching new leads with joins
    const newLeadIds = Array.from(matchingClientIds);
    let newLeadsData = [];

    if (newLeadIds.length > 0) {
      const { data: newLeads, error: newLeadsError } = await supabase
        .from('leads')
        .select(`
          id,
          name,
          lead_number,
          phone,
          mobile,
          email,
          stage,
          status,
          topic,
          created_at,
          scheduler,
          closer,
          handler,
          source,
          category_id,
          misc_category!category_id (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          ),
          lead_stages!stage (
            id,
            name
          )
        `)
        .in('id', newLeadIds);

      if (!newLeadsError && newLeads) {
        newLeadsData = newLeads.map(lead => {
          const category = lead.misc_category;
          const mainCategory = category?.misc_maincategory;
          const mainCategoryName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
          const categoryDisplay = category && mainCategoryName 
            ? `${category.name} (${mainCategoryName})`
            : (category?.name || null);

          const stageData = lead.lead_stages;
          const stageName = Array.isArray(stageData) ? stageData[0]?.name : stageData?.name;

          return {
            ...lead,
            leadType: 'new',
            stage_name: stageName || lead.stage,
            source_name: lead.source, // New leads store source as text
            category_display: categoryDisplay,
            scheduler_name: lead.scheduler
          };
        });
      }
    }

    // Fetch all matching legacy leads with joins
    const legacyLeadIds = Array.from(matchingLeadIds);
    let legacyLeadsData = [];

    if (legacyLeadIds.length > 0) {
      // First, fetch the leads
      const { data: legacyLeads, error: legacyLeadsError } = await supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          phone,
          mobile,
          email,
          stage,
          status,
          topic,
          cdate,
          source_id,
          category_id,
          meeting_scheduler_id,
          meeting_manager_id,
          meeting_lawyer_id,
          expert_id,
          closer_id,
          case_handler_id,
          misc_category!category_id (
            id,
            name,
            parent_id,
            misc_maincategory!parent_id (
              id,
              name
            )
          ),
          misc_leadsource!source_id (
            id,
            name
          ),
          lead_stages!stage (
            id,
            name
          )
        `)
        .in('id', legacyLeadIds);

      if (!legacyLeadsError && legacyLeads) {
        // Fetch employee names for scheduler
        const schedulerIds = legacyLeads
          .map(l => l.meeting_scheduler_id)
          .filter(id => id !== null && id !== undefined);
        
        const schedulerMap = new Map();
        if (schedulerIds.length > 0) {
          const { data: employees } = await supabase
            .from('tenants_employee')
            .select('id, display_name')
            .in('id', schedulerIds);

          if (employees) {
            employees.forEach(emp => {
              schedulerMap.set(emp.id, emp.display_name);
            });
          }
        }

        legacyLeadsData = legacyLeads.map(lead => {
          const category = lead.misc_category;
          const mainCategory = category?.misc_maincategory;
          const mainCategoryName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
          const categoryDisplay = category && mainCategoryName 
            ? `${category.name} (${mainCategoryName})`
            : (category?.name || null);

          const source = lead.misc_leadsource;
          const sourceName = Array.isArray(source) ? source[0]?.name : source?.name;

          const stageData = lead.lead_stages;
          const stageName = Array.isArray(stageData) ? stageData[0]?.name : stageData?.name;

          const schedulerName = lead.meeting_scheduler_id ? schedulerMap.get(lead.meeting_scheduler_id) : null;

          return {
            ...lead,
            leadType: 'legacy',
            stage_name: stageName || lead.stage,
            source_name: sourceName,
            category_display: categoryDisplay,
            scheduler_name: schedulerName,
            lead_number: lead.lead_number || lead.id.toString()
          };
        });
      }
    }

    // Combine all leads
    const allLeads = [...newLeadsData, ...legacyLeadsData];

    // Fetch last 5 calls for this phone number or related leads
    let recentCalls = [];
    try {
      const leadIds = allLeads.map(l => l.leadType === 'legacy' ? l.id : null).filter(id => id !== null);
      
      let callsQuery = supabase
        .from('call_logs')
        .select(`
          id,
          cdate,
          date,
          time,
          source,
          destination,
          direction,
          status,
          duration,
          url,
          call_id,
          lead_id,
          employee_id,
          tenants_employee!employee_id (
            display_name
          )
        `)
        .order('cdate', { ascending: false })
        .limit(5);

      // If we have lead IDs, query by lead_id
      if (leadIds.length > 0) {
        const { data: callsByLeadId } = await callsQuery.in('lead_id', leadIds);
        if (callsByLeadId && callsByLeadId.length > 0) {
          recentCalls = callsByLeadId.map(call => ({
            ...call,
            employee: Array.isArray(call.tenants_employee) ? call.tenants_employee[0] : call.tenants_employee
          }));
        }
      }

      // If no calls found by lead_id, try by destination phone number (last 8 digits)
      if (recentCalls.length === 0 && last8Digits) {
        const { data: callsByPhone } = await supabase
          .from('call_logs')
          .select(`
            id,
            cdate,
            date,
            time,
            source,
            destination,
            direction,
            status,
            duration,
            url,
            call_id,
            lead_id,
            employee_id,
            tenants_employee!employee_id (
              display_name
            )
          `)
          .or(`destination.ilike.%${last8Digits}%,source.ilike.%${last8Digits}%`)
          .order('cdate', { ascending: false })
          .limit(5);
        
        if (callsByPhone && callsByPhone.length > 0) {
          recentCalls = callsByPhone.map(call => ({
            ...call,
            employee: Array.isArray(call.tenants_employee) ? call.tenants_employee[0] : call.tenants_employee
          }));
        }
      }

      // Limit to last 5
      recentCalls = recentCalls.slice(0, 5);
    } catch (error) {
      console.error('Error fetching recent calls:', error);
    }

    return res.json({
      success: true,
      found: allLeads.length > 0,
      phone: phone,
      leads: allLeads,
      contact: contactData,
      recentCalls: recentCalls
    });

  } catch (error) {
    console.error('❌ Error in CTI lookup:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
