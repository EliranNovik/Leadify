const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Middleware to log API access to database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const accessLogger = async (req, res, next) => {
  const startTime = Date.now();
  
  // Capture original send method
  const originalSend = res.send;
  
  // Override send method to capture response
  res.send = function(data) {
    const processingTime = Date.now() - startTime;
    
    // Log the request/response asynchronously (don't block the response)
    logAccess(req, res, data, processingTime).catch(err => {
      console.error('Error logging access:', err);
    });
    
    // Call original send method
    return originalSend.call(this, data);
  };
  
  next();
};

/**
 * Log access to database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} responseBody - Response body
 * @param {number} processingTime - Processing time in milliseconds
 */
const logAccess = async (req, res, responseBody, processingTime) => {
  try {
    // Skip logging for certain endpoints if needed
    if (req.path === '/health' || req.path === '/favicon.ico') {
      return;
    }
    
    // Prepare log data
    const hasBody = req.body && Object.keys(req.body || {}).length > 0;
    const hasQuery = req.query && Object.keys(req.query || {}).length > 0;
    const serializedBody = hasBody
      ? JSON.stringify(req.body)
      : hasQuery
        ? JSON.stringify({ query: req.query })
        : null;

    const logData = {
      request_method: req.method,
      endpoint: req.path || req.originalUrl || req.url,
      request_body: serializedBody,
      response_body: responseBody ? String(responseBody).substring(0, 10000) : null, // Limit to 10KB
      response_code: res.statusCode,
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('User-Agent'),
      processing_time_ms: processingTime,
      user_id: req.user?.id || null,
      session_id: req.session?.id || null
    };
    
    // Insert log into database
    const { error } = await supabase
      .from('access_logs')
      .insert([logData]);
    
    if (error) {
      console.error('Error inserting access log:', error);
    }
  } catch (error) {
    console.error('Error in access logger:', error);
  }
};

module.exports = accessLogger; 