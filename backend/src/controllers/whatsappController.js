const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// WhatsApp API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// Check if we're in development mode (no WhatsApp credentials)
const isDevelopmentMode = !PHONE_NUMBER_ID || !ACCESS_TOKEN;

// Debug environment variables
console.log('WhatsApp Environment Check:');
console.log('PHONE_NUMBER_ID:', PHONE_NUMBER_ID ? 'SET' : 'NOT SET');
console.log('ACCESS_TOKEN:', ACCESS_TOKEN ? 'SET' : 'NOT SET');
console.log('isDevelopmentMode:', isDevelopmentMode);

// WhatsApp Controller initialized

// Verify webhook endpoint
const verifyWebhook = async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
};

// Handle incoming webhook messages
const handleWebhook = async (req, res) => {
  try {
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry[0];
      const changes = entry.changes[0];
      const value = changes.value;
      
      if (value.messages && value.messages.length > 0) {
        const message = value.messages[0];
        await processIncomingMessage(message);
      }
      
      if (value.statuses && value.statuses.length > 0) {
        const status = value.statuses[0];
        await updateMessageStatus(status);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error handling webhook:', error);
    res.sendStatus(500);
  }
};

// Process incoming message
const processIncomingMessage = async (message) => {
  try {
    const {
      from: phoneNumber,
      timestamp,
      type,
      id: whatsappMessageId,
      text,
      image,
      document,
      audio,
      video,
      location,
      contacts,
      profile
    } = message;

    // Find lead by phone number (handle various formats)
    const phoneWithoutCountry = phoneNumber.replace(/^972/, '');
    const phoneWithCountry = phoneNumber.startsWith('972') ? phoneNumber : `972${phoneNumber}`;
    const phoneWithPlus = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const phoneWithoutPlus = phoneNumber.replace(/^\+/, '');
    
    // Normalize phone numbers for comparison (handle all variations)
    const normalizePhone = (phone) => {
      if (!phone || phone === null || phone === '') return '';
      return phone.replace(/\D/g, '');
    };
    
    // Create multiple variations of the incoming phone number
    const incomingNormalized = normalizePhone(phoneNumber);
    const incomingVariations = [
      incomingNormalized,
      incomingNormalized.replace(/^972/, ''), // Remove country code
      incomingNormalized.replace(/^00972/, ''), // Remove 00972 prefix
      incomingNormalized.replace(/^0/, ''), // Remove leading 0
      `972${incomingNormalized.replace(/^972/, '')}`, // Add country code
      `0${incomingNormalized.replace(/^0/, '')}`, // Add leading 0
      incomingNormalized.replace(/^972/, '0'), // Replace 972 with 0
      incomingNormalized.replace(/^0/, '972'), // Replace 0 with 972
    ];
    

    
    // Get all leads and find by normalized phone number
    const { data: allLeads, error: allLeadsError } = await supabase
      .from('leads')
      .select('id, name, lead_number, phone, mobile')
      .not('phone', 'is', null)
      .not('phone', 'eq', '');
    
    if (allLeadsError) {
      console.error('Error fetching leads:', allLeadsError);
      return;
    }
    
    // Find lead by normalized phone number comparison
    let lead = null;
    for (const potentialLead of allLeads) {
      const leadPhoneNormalized = normalizePhone(potentialLead.phone);
      const leadMobileNormalized = normalizePhone(potentialLead.mobile);
      
      // Check if any variation matches
      let foundMatch = false;
      let matchType = '';
      
      for (const variation of incomingVariations) {
        if (leadPhoneNormalized === variation || leadMobileNormalized === variation) {
          foundMatch = true;
          matchType = leadPhoneNormalized === variation ? 'phone' : 'mobile';
          break;
        }
      }
      
      if (foundMatch) {
        lead = potentialLead;
        break;
      }
    }

    // Log profile information for debugging
    console.log('🔍 WhatsApp message profile info:', {
      phoneNumber,
      profile,
      hasProfile: !!profile,
      profileName: profile?.name,
      leadFound: !!lead,
      leadName: lead?.name
    });

    // Determine the best sender name to use
    let senderName;
    if (lead) {
      // For known leads, prefer the lead's name from database
      senderName = lead.name || 'Unknown Client';
    } else {
      // For unknown leads, try to get the WhatsApp profile name
      if (profile && profile.name) {
        senderName = profile.name;
        console.log('✅ Using WhatsApp profile name:', profile.name);
      } else {
        // Try to fetch profile name from WhatsApp API if not in webhook
        try {
          const profileResponse = await axios.get(
            `https://graph.facebook.com/v19.0/${phoneNumber}?fields=profile_picture,name`,
            {
              headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (profileResponse.data && profileResponse.data.name) {
            senderName = profileResponse.data.name;
            console.log('✅ Fetched WhatsApp profile name from API:', profileResponse.data.name);
          } else {
            senderName = phoneNumber;
            console.log('⚠️ No profile name available from API, using phone number:', phoneNumber);
          }
        } catch (profileError) {
          // Fallback to phone number if profile fetch fails
          senderName = phoneNumber;
          console.log('⚠️ Failed to fetch profile name, using phone number:', phoneNumber);
          console.log('Profile fetch error:', profileError.message);
        }
      }
    }

    // Prepare message data - handle both known and unknown leads
    let messageData = {
      lead_id: lead ? lead.id : null, // null for unknown leads
      sender_name: senderName,
      direction: 'in',
      sent_at: new Date(parseInt(timestamp) * 1000).toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'delivered',
      whatsapp_timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
      message_type: type,
      message: '',
      media_url: null,
      media_id: null,
      media_filename: null,
      media_mime_type: null,
      media_size: null,
      caption: null
    };
    
    // Update the lead's phone number if it's a known lead and doesn't match exactly
    if (lead && lead.phone !== phoneNumber && lead.mobile !== phoneNumber) {
      await supabase
        .from('leads')
        .update({ phone: phoneNumber })
        .eq('id', lead.id);
    }

    // Handle different message types
    switch (type) {
      case 'text':
        messageData.message = text.body;
        break;
      
      case 'image':
        messageData.message = image.caption || '';
        messageData.media_id = image.id;
        messageData.media_url = image.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = image.mime_type;
        messageData.media_size = image.file_size;
        messageData.caption = image.caption;
        // Download and store image (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(image.id, 'image', lead ? lead.id : phoneNumber);
        break;
      
      case 'document':
        messageData.message = document.filename;
        messageData.media_id = document.id;
        messageData.media_url = document.id; // Set media_url to WhatsApp media ID
        messageData.media_filename = document.filename;
        messageData.media_mime_type = document.mime_type;
        messageData.media_size = document.file_size;
        // Download and store document (use phone number as fallback for unknown leads)
        await downloadAndStoreMedia(document.id, 'document', lead ? lead.id : phoneNumber);
        break;
      
      case 'audio':
        messageData.message = 'Audio message';
        messageData.media_id = audio.id;
        messageData.media_url = audio.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = audio.mime_type;
        messageData.media_size = audio.file_size;
        await downloadAndStoreMedia(audio.id, 'audio', lead ? lead.id : phoneNumber);
        break;
      
      case 'video':
        messageData.message = video.caption || 'Video message';
        messageData.media_id = video.id;
        messageData.media_url = video.id; // Set media_url to WhatsApp media ID
        messageData.media_mime_type = video.mime_type;
        messageData.media_size = video.file_size;
        messageData.caption = video.caption;
        await downloadAndStoreMedia(video.id, 'video', lead ? lead.id : phoneNumber);
        break;
      
      case 'location':
        messageData.message = `Location: ${location.latitude}, ${location.longitude}`;
        messageData.message_type = 'location';
        break;
      
      case 'contacts':
        messageData.message = 'Contact shared';
        messageData.message_type = 'contact';
        break;
    }

    // Save message to database
    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('Error saving incoming message:', insertError);
    } else {
      if (lead) {
        console.log(`✅ Saved message from known lead: ${lead.name} (${phoneNumber})`);
      } else {
        console.log(`🆕 Saved message from NEW LEAD: ${senderName} (${phoneNumber}) - This will appear on WhatsApp Leads page!`);
      }
    }

  } catch (error) {
    console.error('Error processing incoming message:', error);
  }
};

// Download and store media file
const downloadAndStoreMedia = async (mediaId, type, leadId) => {
  try {

    
    // In production mode, we don't need to download and store locally
    // Just store the WhatsApp media ID for later retrieval
    if (!isDevelopmentMode) {
  
      return;
    }
    
    // Get media URL from WhatsApp
    const mediaResponse = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    const mediaUrl = mediaResponse.data.url;
    
    // Download media file
    const fileResponse = await axios.get(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      },
      responseType: 'stream'
    });

    // Create uploads directory if it doesn't exist
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Save file with unique name
    const fileName = `${leadId}_${Date.now()}_${mediaId}.${getFileExtension(fileResponse.headers['content-type'])}`;
    const filePath = path.join(uploadsDir, fileName);
    
    const writer = fs.createWriteStream(filePath);
    fileResponse.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
    
        resolve();
      });
      writer.on('error', reject);
    });

  } catch (error) {
    console.error('Error downloading media:', error);
  }
};

// Get file extension from MIME type
const getFileExtension = (mimeType) => {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/avi': 'avi'
  };
  return extensions[mimeType] || 'bin';
};

// Update message status
const updateMessageStatus = async (status) => {
  try {
    const { id: whatsappMessageId, status: messageStatus, timestamp } = status;
    
    console.log('📱 WhatsApp Status Update:', {
      messageId: whatsappMessageId,
      status: messageStatus,
      timestamp: timestamp
    });

    const { error } = await supabase
      .from('whatsapp_messages')
      .update({
        whatsapp_status: messageStatus,
        whatsapp_timestamp: new Date(parseInt(timestamp) * 1000).toISOString()
      })
      .eq('whatsapp_message_id', whatsappMessageId);

    if (error) {
      console.error('Error updating message status:', error);
    } else {
      console.log('✅ Message status updated successfully:', messageStatus);
    }

  } catch (error) {
    console.error('Error updating message status:', error);
  }
};

// Send WhatsApp message
const sendMessage = async (req, res) => {
  try {
    console.log('📨 Received send message request:', { 
      leadId: req.body.leadId, 
      phoneNumber: req.body.phoneNumber, 
      messageLength: req.body.message?.length, 
      isTemplate: req.body.isTemplate,
      templateName: req.body.templateName,
      templateParameters: req.body.templateParameters
    });
    const { leadId, message, phoneNumber, isTemplate, templateName, templateLanguage, templateParameters } = req.body;

    if (!message || !phoneNumber) {
      return res.status(400).json({ error: 'Message and phone number are required' });
    }

    // Check if this is a legacy lead
    const isLegacyLead = leadId.toString().startsWith('legacy_');
    let lead = null;
    
    if (isLegacyLead) {
      // For legacy leads, get from leads_lead table
      const legacyId = parseInt(leadId.replace('legacy_', ''));
      const { data: legacyLead, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name')
        .eq('id', legacyId)
        .single();

      if (legacyError || !legacyLead) {
        return res.status(404).json({ error: 'Legacy lead not found' });
      }
      
      lead = {
        id: legacyId,
        name: legacyLead.name,
        lead_number: legacyId.toString()
      };
    } else {
      // For new leads, get from leads table
      const { data: newLead, error: newError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .eq('id', leadId)
        .single();

      if (newError || !newLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      lead = newLead;
    }

    let whatsappMessageId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock WhatsApp API response for development
      console.log('📱 Sending message in DEVELOPMENT MODE (mock)');
      console.log('📱 Message:', message);
      console.log('📱 Phone:', phoneNumber);

      whatsappMessageId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Message sent successfully (MOCK MODE)'
      };
    } else {
      console.log('📱 Sending message via REAL WhatsApp API');
      console.log('📱 Message:', message);
      console.log('📱 Phone:', phoneNumber);
      console.log('📱 Is Template:', isTemplate);
      
      let messagePayload;
      
      if (isTemplate) {
        console.log('📱 Sending TEMPLATE message');
        // Send template message
        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'template',
          template: {
            name: templateName || 'second_test',
            language: {
              code: templateLanguage || 'en_US'
            }
          }
        };
        
        // Add components if template parameters are provided
        if (templateParameters && templateParameters.length > 0) {
          messagePayload.template.components = [
            {
              type: 'body',
              parameters: templateParameters
            }
          ];
        }
        
        console.log('📱 Template payload:', messagePayload);
      } else {
        // Send regular text message
        messagePayload = {
          messaging_product: 'whatsapp',
          to: phoneNumber,
          type: 'text',
          text: { body: message }
        };
      }
      
      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        messagePayload,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      whatsappMessageId = response.data.messages[0].id;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Message sent successfully'
      };
    }

    // Save message to database
    const messageData = {
      lead_id: isLegacyLead ? null : leadId, // Set to null for legacy leads
      legacy_id: isLegacyLead ? lead.id : null, // Set legacy_id for legacy leads
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: isTemplate ? `[Template: ${templateName}] ${templateParameters?.[0]?.text || ''}` : message,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: isTemplate ? 'template' : 'text',
      whatsapp_timestamp: new Date().toISOString()
    };

    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('Error saving outgoing message:', insertError);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    console.log('✅ Message sent successfully:', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error sending message:', error);
    
    // Check if it's a WhatsApp API error
    if (error.response && error.response.data && error.response.data.error) {
      const whatsappError = error.response.data.error;
      if (whatsappError.code === 131047) {
        res.status(400).json({ 
          error: 'Message failed: More than 24 hours have passed since the customer last replied. You can only send template messages after 24 hours.',
          code: 'RE_ENGAGEMENT_REQUIRED'
        });
      } else {
        res.status(400).json({ 
          error: `WhatsApp API Error: ${whatsappError.message}`,
          code: whatsappError.code
        });
      }
    } else {
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
};

// Send WhatsApp media
const sendMedia = async (req, res) => {
  try {


    const { leadId, mediaUrl, mediaType, caption, phoneNumber } = req.body;

    if (!mediaUrl || !phoneNumber) {
      return res.status(400).json({ error: 'Media URL and phone number are required' });
    }

    // Check if this is a legacy lead
    const isLegacyLead = leadId.toString().startsWith('legacy_');
    let lead = null;
    
    if (isLegacyLead) {
      // For legacy leads, get from leads_lead table
      const legacyId = parseInt(leadId.replace('legacy_', ''));
      const { data: legacyLead, error: legacyError } = await supabase
        .from('leads_lead')
        .select('id, name')
        .eq('id', legacyId)
        .single();

      if (legacyError || !legacyLead) {
        return res.status(404).json({ error: 'Legacy lead not found' });
      }
      
      lead = {
        id: legacyId,
        name: legacyLead.name,
        lead_number: legacyId.toString()
      };
    } else {
      // For new leads, get from leads table
      const { data: newLead, error: newError } = await supabase
        .from('leads')
        .select('id, name, lead_number')
        .eq('id', leadId)
        .single();

      if (newError || !newLead) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      
      lead = newLead;
    }

    let whatsappMessageId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock WhatsApp API response for development

      whatsappMessageId = `mock_media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Media message sent successfully (MOCK MODE)'
      };
    } else {
      // Send media message using the mediaUrl (which should be the media ID from upload)
      const messagePayload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: mediaType,
        [mediaType]: {
          id: mediaUrl // Use the media ID from the upload step
        }
      };

      if (caption) {
        messagePayload[mediaType].caption = caption;
      }



      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
        messagePayload,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );

      whatsappMessageId = response.data.messages[0].id;
      responseData = {
        success: true,
        messageId: whatsappMessageId,
        message: 'Media message sent successfully'
      };
    }

    // Save message to database
    const messageData = {
      lead_id: isLegacyLead ? null : leadId, // Set to null for legacy leads
      legacy_id: isLegacyLead ? lead.id : null, // Set legacy_id for legacy leads
      sender_name: req.body.sender_name || 'You',
      direction: 'out',
      message: caption || `${mediaType} message`,
      sent_at: new Date().toISOString(),
      whatsapp_message_id: whatsappMessageId,
      whatsapp_status: 'pending', // Start as pending, will be updated by webhook
      message_type: mediaType,
      media_url: mediaUrl,
      caption: caption
    };

    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert([messageData]);

    if (insertError) {
      console.error('Error saving outgoing media message:', insertError);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error sending media message:', error);
    res.status(500).json({ error: 'Failed to send media message' });
  }
};

// Get message status
const getMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: message, error } = await supabase
      .from('whatsapp_messages')
      .select('whatsapp_status, whatsapp_timestamp, error_message')
      .eq('whatsapp_message_id', messageId)
      .single();

    if (error || !message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(message);

  } catch (error) {
    console.error('Error getting message status:', error);
    res.status(500).json({ error: 'Failed to get message status' });
  }
};

// Get conversation history
const getConversation = async (req, res) => {
  try {
    const { leadId } = req.params;

    const { data: messages, error } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('lead_id', leadId)
      .order('sent_at', { ascending: true });

    if (error) {
      console.error('Error fetching conversation:', error);
      return res.status(500).json({ error: 'Failed to fetch conversation' });
    }

    res.json(messages);

  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

// Debug endpoint to find leads by phone number
const findLeadsByPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, name, lead_number, phone, mobile, created_at')
      .or(`phone.eq.${phoneNumber},mobile.eq.${phoneNumber}`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error finding leads:', error);
      return res.status(500).json({ error: 'Failed to find leads' });
    }

    res.json(leads);

  } catch (error) {
    console.error('Error finding leads by phone:', error);
    res.status(500).json({ error: 'Failed to find leads by phone' });
  }
};

// Upload media to WhatsApp
const uploadMedia = async (req, res) => {
  try {


    const { file } = req;
    const { leadId, caption } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload file to your server first
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = `${leadId}_${Date.now()}_${file.originalname}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, file.buffer);

    let mediaId;
    let responseData;

    if (isDevelopmentMode) {
      // Mock media upload for development

      mediaId = fileName; // Use the actual filename as the media ID
      responseData = {
        success: true,
        mediaId: mediaId,
        fileName: fileName
      };
    } else {
      // Upload to WhatsApp
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('file', fs.createReadStream(filePath));



      const response = await axios.post(
        `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            ...formData.getHeaders()
          }
        }
      );

      mediaId = response.data.id;
      responseData = {
        success: true,
        mediaId: mediaId,
        fileName: fileName
      };
      

    }

    res.json(responseData);

  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
};

// Get media from WhatsApp
const getMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;

    if (!mediaId) {
      return res.status(400).json({ error: 'Media ID is required' });
    }

    // Check if this is a mock/test media ID
    if (mediaId.includes('mock_') || mediaId.includes('test_')) {
      return res.status(404).json({ error: 'Mock media not available in production' });
    }

    if (isDevelopmentMode) {
      // In development mode, serve from local uploads
      const uploadsDir = path.join(__dirname, '../../uploads');

      
      // First try exact match
      let filePath = path.join(uploadsDir, mediaId);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
      
      // If not found, search for files containing the media ID
      try {
        const files = fs.readdirSync(uploadsDir);
        const matchingFile = files.find(file => file.includes(mediaId));
        
        if (matchingFile) {
          filePath = path.join(uploadsDir, matchingFile);
          return res.sendFile(filePath);
        } else {
          return res.status(404).json({ error: 'Media not found' });
        }
      } catch (error) {
        console.error('❌ Error reading uploads directory:', error);
        return res.status(500).json({ error: 'Failed to read uploads directory' });
      }
    } else {
      // Get media URL from WhatsApp
      try {
        const mediaResponse = await axios.get(
          `${WHATSAPP_API_URL}/${mediaId}`,
          {
            headers: {
              'Authorization': `Bearer ${ACCESS_TOKEN}`
            }
          }
        );

        const mediaUrl = mediaResponse.data.url;
        
        // Download and serve the media
        const fileResponse = await axios.get(mediaUrl, {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`
          },
          responseType: 'stream'
        });

        // Set appropriate headers
        res.setHeader('Content-Type', fileResponse.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Content-Length', fileResponse.headers['content-length'] || '');
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        
        // Pipe the file stream to response
        fileResponse.data.pipe(res);
      } catch (error) {
        console.error('Error getting media from WhatsApp API:', error.response?.data || error.message);
        
        // If it's a 400 error (media not found), return a proper error
        if (error.response?.status === 400) {
          return res.status(404).json({ 
            error: 'Media not found or no longer available',
            details: error.response.data?.error?.message || 'Media ID does not exist'
          });
        }
        
        return res.status(500).json({ error: 'Failed to get media from WhatsApp' });
      }
    }

  } catch (error) {
    console.error('Error getting media:', error);
    res.status(500).json({ error: 'Failed to get media' });
  }
};

module.exports = {
  verifyWebhook,
  handleWebhook,
  sendMessage,
  sendMedia,
  getMessageStatus,
  getConversation,
  findLeadsByPhone,
  uploadMedia,
  getMedia,
  updateMessageStatus
}; 