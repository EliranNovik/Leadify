const clientBookingService = require('../services/clientBookingService');

const DEFAULT_SECRET = '2KrVDK18qRr1YV8';

function resolveWebhookSecret(req) {
  const headerSecret =
    req.headers['x-partner-webhook-secret']
    || req.headers['x-webhook-password']
    || req.headers['authorization'];

  if (headerSecret && String(headerSecret).startsWith('Bearer ')) {
    return String(headerSecret).slice('Bearer '.length).trim();
  }

  return (
    req.body?.password
    || req.body?.webhook_password
    || req.body?.secret
    || headerSecret
    || null
  );
}

function isAuthorized(req) {
  const expected = process.env.PARTNER_MEETING_WEBHOOK_SECRET || DEFAULT_SECRET;
  const provided = String(resolveWebhookSecret(req) || '').trim();
  return provided.length > 0 && provided === expected;
}

const partnerMeetingWebhookController = {
  async health(req, res) {
    res.status(200).json({
      success: true,
      message: 'Partner meeting webhook is active',
      endpoint: 'POST /api/hook/partner/meeting',
      timestamp: new Date().toISOString(),
    });
  },

  async createMeeting(req, res) {
    try {
      if (!isAuthorized(req)) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
          message: 'Invalid or missing webhook password',
        });
      }

      const body = req.body?.query && Object.keys(req.body.query).length > 0
        ? req.body.query
        : req.body;

      const result = await clientBookingService.createPartnerMeeting({
        lead_ref: body?.lead_ref || body?.lead_number,
        lead_number: body?.lead_number,
        date: body?.date || body?.meeting_date,
        time: body?.time || body?.meeting_time,
        country: body?.country || body?.ISO,
        client_timezone: body?.client_timezone || body?.timezone,
        contact_id: body?.contact_id,
        contact_email: body?.contact_email || body?.email,
        meeting_location: body?.meeting_location || body?.location,
        notes: body?.notes || body?.brief || body?.meeting_brief,
        partner_name: body?.partner_name || body?.source,
        skip_availability_check: body?.skip_availability_check === true
          || body?.skip_availability_check === 'true',
        send_notifications: body?.send_notifications !== false
          && body?.send_notifications !== 'false',
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('partner meeting webhook error:', error);
      const message = error.message || 'Failed to create meeting';
      const status = /not found|required|invalid|not available|provide contact/i.test(message)
        ? 400
        : 500;
      res.status(status).json({ success: false, error: message });
    }
  },
};

module.exports = partnerMeetingWebhookController;
