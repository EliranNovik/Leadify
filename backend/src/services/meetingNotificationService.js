const { createClient } = require('@supabase/supabase-js');
const pushNotificationService = require('./pushNotificationService');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  Supabase credentials missing for meeting notification service');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// In-memory cache to track which meetings have been notified
// Format: { meetingId_userId: timestamp }
const notifiedMeetings = new Map();
const NOTIFICATION_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours - clear old entries

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of notifiedMeetings.entries()) {
    if (now - timestamp > NOTIFICATION_CACHE_TTL) {
      notifiedMeetings.delete(key);
    }
  }
}, 30 * 60 * 1000); // Clean every 30 minutes

/**
 * Check if a meeting notification has already been sent
 */
const hasBeenNotified = (meetingId, userId) => {
  const key = `${meetingId}_${userId}`;
  return notifiedMeetings.has(key);
};

/**
 * Mark a meeting as notified for a user
 */
const markAsNotified = (meetingId, userId) => {
  const key = `${meetingId}_${userId}`;
  notifiedMeetings.set(key, Date.now());
};

/**
 * Get user's employee ID and email from auth_id
 */
const getUserInfo = async (authId) => {
  if (!supabase) return null;

  const { data: userData, error } = await supabase
    .from('users')
    .select(`
      id,
      employee_id,
      email,
      tenants_employee!employee_id(
        id,
        display_name
      )
    `)
    .eq('auth_id', authId)
    .single();

  if (error || !userData) {
    return null;
  }

  return {
    userId: userData.id,
    employeeId: userData.employee_id,
    email: userData.email,
    displayName: userData.tenants_employee?.display_name || null,
  };
};

/**
 * Check if a user is assigned to a meeting based on roles
 */
const isUserAssignedToMeeting = (meeting, userInfo) => {
  if (!userInfo) return false;

  const { employeeId, email, displayName } = userInfo;

  // Check new lead meeting roles
  if (meeting.lead) {
    const lead = meeting.lead;
    
    // Check by employee ID
    if (employeeId) {
      if (lead.expert && !isNaN(Number(lead.expert)) && Number(lead.expert) === employeeId) return true;
      if (lead.manager && !isNaN(Number(lead.manager)) && Number(lead.manager) === employeeId) return true;
      if (lead.scheduler && !isNaN(Number(lead.scheduler)) && Number(lead.scheduler) === employeeId) return true;
      if (lead.closer && !isNaN(Number(lead.closer)) && Number(lead.closer) === employeeId) return true;
      if (lead.handler && !isNaN(Number(lead.handler)) && Number(lead.handler) === employeeId) return true;
    }
    
    // Check by display name (text match)
    if (displayName) {
      if (lead.expert === displayName) return true;
      if (lead.manager === displayName) return true;
      if (lead.meeting_manager === displayName) return true;
      if (lead.scheduler === displayName) return true;
      if (lead.closer === displayName) return true;
      if (lead.helper === displayName) return true;
      if (meeting.expert === displayName) return true;
      if (meeting.meeting_manager === displayName) return true;
      if (meeting.helper === displayName) return true;
    }
  }

  // Check legacy lead meeting roles
  if (meeting.legacy_lead) {
    const legacyLead = meeting.legacy_lead;
    
    if (employeeId) {
      if (legacyLead.expert_id === employeeId) return true;
      if (legacyLead.meeting_manager_id === employeeId) return true;
      if (legacyLead.meeting_scheduler_id === employeeId) return true;
      if (legacyLead.meeting_lawyer_id === employeeId) return true;
      if (legacyLead.closer_id === employeeId) return true;
      if (legacyLead.case_handler_id === employeeId) return true;
    }
  }

  // Check staff meetings (outlook_teams_meetings) by email
  if (meeting.attendees && Array.isArray(meeting.attendees) && email) {
    const userEmailLower = email.toLowerCase();
    const hasEmail = meeting.attendees.some((attendee) => {
      const attendeeEmail = typeof attendee === 'string'
        ? attendee.toLowerCase()
        : (attendee.email || '').toLowerCase();
      return attendeeEmail === userEmailLower;
    });
    if (hasEmail) return true;
  }

  return false;
};

/**
 * Calculate time until meeting in a human-readable format
 */
const formatTimeUntil = (meetingDateTime) => {
  const now = new Date();
  const diffMs = meetingDateTime.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (mins === 0) return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  return `in ${hours}h ${mins}m`;
};

/**
 * Check for meetings within 1 hour and send push notifications
 */
const checkAndNotifyMeetings = async () => {
  if (!supabase) {
    console.warn('⚠️  Supabase not configured for meeting notifications');
    return { checked: 0, notified: 0 };
  }

  try {
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    const todayStr = now.toISOString().split('T')[0];

    console.log(`🔔 Checking for meetings within 1 hour (${now.toISOString()} to ${oneHourLater.toISOString()})`);

    // Fetch all meetings for today
    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select(`
        id,
        meeting_date,
        meeting_time,
        meeting_location,
        meeting_manager,
        expert,
        helper,
        teams_meeting_url,
        lead:leads!client_id(
          id, name, lead_number, manager, topic, expert, stage, scheduler, closer, handler, balance, balance_currency,
          meeting_manager_id, expert_id, case_handler_id
        ),
        legacy_lead:leads_lead!legacy_lead_id(
          id, name, meeting_manager_id, meeting_lawyer_id, meeting_scheduler_id, category, category_id, expert_id, stage, closer_id, case_handler_id, total, currency_id
        )
      `)
      .eq('meeting_date', todayStr)
      .or('status.is.null,status.neq.canceled');

    if (meetingsError) {
      console.error('❌ Error fetching meetings:', meetingsError);
      return { checked: 0, notified: 0, error: meetingsError.message };
    }

    if (!meetings || meetings.length === 0) {
      console.log('📅 No meetings found for today');
      return { checked: 0, notified: 0 };
    }

    // Fetch staff meetings (outlook_teams_meetings) for today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const { data: staffMeetings, error: staffMeetingsError } = await supabase
      .from('outlook_teams_meetings')
      .select('*')
      .gte('start_date_time', todayStart.toISOString())
      .lte('start_date_time', todayEnd.toISOString())
      .or('status.is.null,status.neq.cancelled');

    if (staffMeetingsError) {
      console.error('❌ Error fetching staff meetings:', staffMeetingsError);
    }

    // Get all active users with push subscriptions
    const { data: usersWithSubscriptions, error: usersError } = await supabase
      .from('push_subscriptions')
      .select('user_id, users!inner(auth_id)')
      .not('user_id', 'is', null)
      .not('users.auth_id', 'is', null);

    if (usersError) {
      console.error('❌ Error fetching users with push subscriptions:', usersError);
      return { checked: 0, notified: 0, error: usersError.message };
    }

    if (!usersWithSubscriptions || usersWithSubscriptions.length === 0) {
      console.log('📱 No users with push subscriptions found');
      return { checked: 0, notified: 0 };
    }

    // Get unique user IDs
    const uniqueUserIds = [...new Set(usersWithSubscriptions.map(s => s.user_id))];
    console.log(`👥 Found ${uniqueUserIds.length} users with push subscriptions`);

    let notifiedCount = 0;
    const allMeetings = [...(meetings || []), ...(staffMeetings || [])];

    // Process each user
    for (const subscription of usersWithSubscriptions) {
      const userId = subscription.user_id;
      const authId = subscription.users?.auth_id;

      if (!authId) continue;

      // Get user info (employee ID, email, display name)
      const userInfo = await getUserInfo(authId);
      if (!userInfo) continue;

      // Check each meeting
      for (const meeting of allMeetings) {
        // Skip if already notified
        if (hasBeenNotified(meeting.id, userId)) {
          continue;
        }

        // Check if user is assigned to this meeting
        if (!isUserAssignedToMeeting(meeting, userInfo)) {
          continue;
        }

        // Calculate meeting datetime
        let meetingDateTime;
        if (meeting.start_date_time) {
          // Staff meeting (outlook_teams_meetings)
          meetingDateTime = new Date(meeting.start_date_time);
        } else if (meeting.meeting_time && meeting.meeting_date) {
          // Regular meeting
          const timeParts = meeting.meeting_time.split(':');
          if (timeParts.length < 2) continue;
          
          meetingDateTime = new Date(meeting.meeting_date);
          meetingDateTime.setHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), 0, 0);
        } else {
          continue;
        }

        // Check if meeting is within 1 hour (not in the past, and within 1 hour from now)
        if (meetingDateTime < now || meetingDateTime > oneHourLater) {
          continue;
        }

        // Prepare notification
        const meetingName = meeting.lead?.name || meeting.legacy_lead?.name || meeting.subject || 'Meeting';
        const leadNumber = meeting.lead?.lead_number || meeting.legacy_lead?.lead_number || '';
        const timeUntil = formatTimeUntil(meetingDateTime);
        const location = meeting.meeting_location || meeting.location || 'Teams';
        const meetingUrl = meeting.teams_meeting_url || meeting.teams_join_url || '';

        const notificationPayload = {
          title: 'Meeting Reminder',
          body: `Meeting ${timeUntil} with ${meetingName}${leadNumber ? ` (${leadNumber})` : ''}${location ? ` - ${location}` : ''}`,
          icon: '/icon-192x192.png',
          badge: '/icon-72x72.png',
          tag: `meeting-${meeting.id}`,
          url: meetingUrl || '/calendar',
          type: 'meeting',
          id: meeting.id.toString(),
          vibrate: [200, 100, 200],
          requireInteraction: false,
        };

        // Send push notification
        try {
          const result = await pushNotificationService.sendNotificationToUser(userId, notificationPayload);
          if (result.success && result.sent > 0) {
            markAsNotified(meeting.id, userId);
            notifiedCount++;
            console.log(`✅ Sent meeting notification to user ${userId} for meeting ${meeting.id} (${meetingName})`);
          }
        } catch (error) {
          console.error(`❌ Error sending notification to user ${userId} for meeting ${meeting.id}:`, error);
        }
      }
    }

    console.log(`📊 Meeting notification check completed: ${notifiedCount} notification(s) sent`);
    return { checked: allMeetings.length, notified: notifiedCount };
  } catch (error) {
    console.error('❌ Error in checkAndNotifyMeetings:', error);
    return { checked: 0, notified: 0, error: error.message };
  }
};

module.exports = {
  checkAndNotifyMeetings,
};

