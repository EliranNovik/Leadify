const clientBookingService = require('../services/clientBookingService');

/**
 * The secret the webhook shipped with, kept only so a partner already calling with it is not cut
 * off mid-integration. Set PARTNER_MEETING_WEBHOOK_SECRET and it stops being accepted.
 */
const LEGACY_SECRET = '2KrVDK18qRr1YV8';

/**
 * Every secret currently accepted.
 *
 * A comma-separated PARTNER_MEETING_WEBHOOK_SECRET is how a secret gets rotated without an
 * outage: publish the new one, keep the old one listed while the partner switches over, then drop
 * it. With nothing set, only the legacy secret above works and each call says so in the log, which
 * is how we see whether anyone still depends on it.
 */
function acceptedSecrets() {
  const configured = String(process.env.PARTNER_MEETING_WEBHOOK_SECRET || '')
    .split(',')
    .map((secret) => secret.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : [LEGACY_SECRET];
}

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
  const provided = String(resolveWebhookSecret(req) || '').trim();
  if (!provided) return false;

  const accepted = acceptedSecrets();
  if (!accepted.includes(provided)) return false;

  if (provided === LEGACY_SECRET && !process.env.PARTNER_MEETING_WEBHOOK_SECRET) {
    console.warn(
      '⚠️  Partner webhook authorised with the built-in secret. Set PARTNER_MEETING_WEBHOOK_SECRET to rotate it.',
    );
  }
  return true;
}

function unauthorized(res) {
  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    message: 'Invalid or missing webhook password',
  });
}

/** 400 for anything the caller can fix, 500 for anything it cannot. */
function statusForError(message) {
  return /not found|required|invalid|not available|provide contact|must be/i.test(message) ? 400 : 500;
}

const partnerMeetingWebhookController = {
  async health(req, res) {
    res.status(200).json({
      success: true,
      message: 'Partner meeting webhook is active',
      endpoint: 'POST /api/hook/partner/meeting',
      leadStageEndpoint: 'POST /api/hook/partner/lead-stage',
      leadStages: clientBookingService.PARTNER_STAGES,
      crmOutboundNotifications: clientBookingService.isPexCrmOutboundEnabled(),
      timestamp: new Date().toISOString(),
    });
  },

  async createMeeting(req, res) {
    try {
      if (!isAuthorized(req)) return unauthorized(res);

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
        external_firm_id: body?.external_firm_id || body?.firm_id,
        stage: body?.stage ?? body?.lead_stage,
        skip_availability_check: body?.skip_availability_check === true
          || body?.skip_availability_check === 'true',
        send_notifications: body?.send_notifications !== false
          && body?.send_notifications !== 'false',
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('partner meeting webhook error:', error);
      const message = error.message || 'Failed to create meeting';
      res.status(statusForError(message)).json({ success: false, error: message });
    }
  },

  /**
   * Move a lead to a stage a partner can know about — "Another meeting", or "Client signed
   * agreement" once its client has signed. The partner's key cannot write `leads` directly, and
   * deliberately: the stage has to arrive with its history row and its triggers, which is what
   * this does.
   */
  async setLeadStage(req, res) {
    try {
      if (!isAuthorized(req)) return unauthorized(res);

      const body = req.body?.query && Object.keys(req.body.query).length > 0
        ? req.body.query
        : req.body;

      const result = await clientBookingService.setPartnerLeadStage({
        lead_ref: body?.lead_ref || body?.lead_number,
        stage: body?.stage ?? body?.lead_stage,
        external_firm_id: body?.external_firm_id || body?.firm_id,
      });

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('partner lead stage webhook error:', error);
      const message = error.message || 'Failed to set lead stage';
      res.status(statusForError(message)).json({ success: false, error: message });
    }
  },
};

module.exports = partnerMeetingWebhookController;
