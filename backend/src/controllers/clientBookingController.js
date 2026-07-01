const clientBookingService = require('../services/clientBookingService');

const clientBookingController = {
  async config(req, res) {
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) {
        return res.status(400).json({ success: false, error: 'token is required' });
      }
      const data = await clientBookingService.getPublicConfig(token);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('client-booking config error:', error);
      res.status(404).json({ success: false, error: error.message || 'Not found' });
    }
  },

  async slots(req, res) {
    try {
      const token = String(req.body?.token || '').trim();
      const date = String(req.body?.date || '').trim();
      const clientTimezone = String(req.body?.client_timezone || '').trim() || undefined;
      if (!token || !date) {
        return res.status(400).json({ success: false, error: 'token and date are required' });
      }
      const data = await clientBookingService.getAvailableSlots(token, date, clientTimezone);
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('client-booking slots error:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to load slots' });
    }
  },

  async book(req, res) {
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) {
        return res.status(400).json({ success: false, error: 'token is required' });
      }
      const result = await clientBookingService.bookMeeting(token, {
        date: req.body?.date,
        time: req.body?.time,
        contact_id: req.body?.contact_id,
        meeting_location: req.body?.meeting_location,
        notes: req.body?.notes,
        client_timezone: req.body?.client_timezone,
      });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('client-booking book error:', error);
      res.status(400).json({ success: false, error: error.message || 'Booking failed' });
    }
  },

  async meetings(req, res) {
    try {
      const token = String(req.body?.token || '').trim();
      if (!token) {
        return res.status(400).json({ success: false, error: 'token is required' });
      }
      const meetings = await clientBookingService.getScheduledMeetings(token);
      res.status(200).json({ success: true, data: { meetings } });
    } catch (error) {
      console.error('client-booking meetings error:', error);
      res.status(404).json({ success: false, error: error.message || 'Not found' });
    }
  },
};

module.exports = clientBookingController;
