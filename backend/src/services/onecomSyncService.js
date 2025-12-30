const supabase = require('../config/supabase');

class OneComSyncService {
  constructor() {
    this.apiKey = process.env.ONECOM_API_KEY;
    this.tenant = process.env.ONECOM_TENANT;
    this.baseUrl = process.env.ONECOM_BASE_URL || 'https://pbx6webserver.1com.co.il/pbx/proxyapi.php';
  }

  /**
   * Convert date from YYYY-MM-DD to DD-MM-YYYY format for 1com API
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {string} Date in DD-MM-YYYY format
   */
  convertDateForOneCom(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  }

  /**
   * Fetch call logs from 1com API
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format
   * @param {string} extensions - Comma-separated list of extensions (optional)
   * @returns {Promise<Object>}
   */
  async fetchCallLogsFromOneCom(startDate, endDate, extensions = null) {
    try {
      console.log('🔍 DEBUG: Starting fetchCallLogsFromOneCom');
      console.log('🔍 DEBUG: API Key:', this.apiKey ? `${this.apiKey.substring(0, 4)}...` : 'NOT SET');
      console.log('🔍 DEBUG: Tenant:', this.tenant || 'NOT SET');
      console.log('🔍 DEBUG: Base URL:', this.baseUrl);
      console.log('🔍 DEBUG: Start Date:', startDate);
      console.log('🔍 DEBUG: End Date:', endDate);
      console.log('🔍 DEBUG: Extensions:', extensions);

      // Build API parameters with date filtering
      // According to OneCom API docs, use uppercase CDRS
      const params = new URLSearchParams({
        key: this.apiKey,
        reqtype: 'INFO',
        info: 'CDRS',
        tenant: this.tenant,
        format: 'csv'
      });

      // Add date filtering if dates are provided
      if (startDate && endDate) {
        // OneCom API expects dates in YYYY-MM-DD format
        params.append('start', startDate);
        params.append('end', endDate);
        console.log('🔍 DEBUG: Adding date filter:', { start: startDate, end: endDate });
      }

      // NOTE: We do NOT use the 'phone' parameter here because OneCom API's phone filter
      // doesn't work reliably for extensions. Instead, we fetch all calls and filter
      // client-side by matching extensions in src, realsrc, dst, and channel fields.
      // This is more reliable and works for both extensions and phone numbers.

      const url = `${this.baseUrl}?${params.toString()}`;
      console.log('🔗 DEBUG: Full 1com URL:', url);

      console.log('🔍 DEBUG: Making fetch request...');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/csv, application/json',
          'User-Agent': 'RMQ-CRM/1.0'
        }
      });

      console.log('🔍 DEBUG: Response status:', response.status);
      console.log('🔍 DEBUG: Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        console.log('❌ DEBUG: Response not OK:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      console.log('🔍 DEBUG: Content-Type:', contentType);
      
      if (contentType?.includes('application/json')) {
        console.log('🔍 DEBUG: Processing JSON response...');
        const jsonData = await response.json();
        console.log('🔍 DEBUG: JSON data:', jsonData);
        return {
          success: false,
          error: jsonData.error || 'Unknown error from 1com API',
          message: jsonData.message
        };
      } else {
        console.log('🔍 DEBUG: Processing CSV response...');
        const csvData = await response.text();
        console.log('🔍 DEBUG: CSV data length:', csvData.length);
        console.log('🔍 DEBUG: CSV data preview (first 500 chars):', csvData.substring(0, 500));
        
        const parsedData = this.parseCsvResponse(csvData);
        console.log('🔍 DEBUG: Parsed data count:', parsedData.length);
        
        return {
          success: true,
          data: parsedData
        };
      }
    } catch (error) {
      console.error('❌ DEBUG: Error in fetchCallLogsFromOneCom:', error);
      console.error('❌ DEBUG: Error stack:', error.stack);
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Parse CSV response from 1com API using header-based parsing
   * @param {string} csvData - Raw CSV string
   * @returns {Array}
   */
  parseCsvResponse(csvData) {
    try {
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        console.log('⚠️ CSV has less than 2 lines, returning empty array');
        return [];
      }

      // Parse header row to get column indices
      const headerLine = lines[0];
      const headers = this.parseCsvLine(headerLine).map(h => h.trim().toLowerCase());
      
      // Create index map for quick lookup
      const idx = {};
      headers.forEach((header, index) => {
        idx[header] = index;
      });

      // Debug: Log header and first data line
      console.log('📋 CSV HEADER:', headers);
      if (lines.length > 1) {
        console.log('📋 FIRST DATA LINE:', lines[1].substring(0, 200));
      }

      // Helper function to get field value by name
      const getField = (fields, name) => {
        const index = idx[name.toLowerCase()];
        return index !== undefined ? (fields[index] ?? '') : '';
      };

      const dataLines = lines.slice(1);
      const records = [];

      for (const line of dataLines) {
        if (!line.trim()) continue;
        
        const fields = this.parseCsvLine(line);
        
        // Build record using header-based mapping
        records.push({
          accountcode: getField(fields, 'accountcode'),
          call_id: getField(fields, 'call_id'),
          start: getField(fields, 'start'),
          answer: getField(fields, 'answer'),
          end: getField(fields, 'end'),
          clid: getField(fields, 'clid'),
          realsrc: getField(fields, 'realsrc'),
          firstdst: getField(fields, 'firstdst'),
          duration: parseInt(getField(fields, 'duration')) || 0,
          billsec: parseInt(getField(fields, 'billsec')) || 0,
          disposition: getField(fields, 'disposition'),
          cc_cost: getField(fields, 'cc_cost'),
          dcontext: getField(fields, 'dcontext'),
          dstchannel: getField(fields, 'dstchannel'),
          srcchannel: getField(fields, 'srcchannel'), // Added srcchannel
          userfield: getField(fields, 'userfield'),
          uniqueid: getField(fields, 'uniqueid'),
          prevuniqueid: getField(fields, 'prevuniqueid'),
          lastdst: getField(fields, 'lastdst'),
          wherelanded: getField(fields, 'wherelanded'),
          src: getField(fields, 'src'),
          dst: getField(fields, 'dst'),
          lastapp: getField(fields, 'lastapp'),
          srcCallID: getField(fields, 'srccallid') || getField(fields, 'srcCallID'),
          linkedid: getField(fields, 'linkedid'),
          peeraccount: getField(fields, 'peeraccount'),
          originateid: getField(fields, 'originateid'),
          cc_country: getField(fields, 'cc_country'),
          cc_network: getField(fields, 'cc_network'),
          pincode: getField(fields, 'pincode'),
          cc_buy: getField(fields, 'cc_buy')
        });
      }

      console.log(`✅ Parsed ${records.length} call log records from 1com`);
      return records;
    } catch (error) {
      console.error('❌ Error parsing CSV response:', error);
      console.error('❌ Error stack:', error.stack);
      return [];
    }
  }

  /**
   * Parse a single CSV line handling quoted fields
   * @param {string} line - CSV line string
   * @returns {Array}
   */
  parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }

    fields.push(current.trim());
    return fields;
  }

  /**
   * Map 1com call log data to our database schema
   * @param {Object} onecomRecord - Raw 1com record
   * @returns {Object}
   */
  async mapOneComToDatabase(onecomRecord, cachedEmployeesList = null) {
    // Parse the start date/time from OneCom record
    // OneCom returns dates in format: "YYYY-MM-DD HH:MM:SS" (local time)
    // Extract date directly to avoid timezone conversion issues
    let date, time;
    if (onecomRecord.start && typeof onecomRecord.start === 'string') {
      // Extract date and time directly from the string format "YYYY-MM-DD HH:MM:SS"
      const dateTimeMatch = onecomRecord.start.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
      if (dateTimeMatch) {
        date = dateTimeMatch[1]; // YYYY-MM-DD
        time = dateTimeMatch[2]; // HH:MM:SS
      } else {
        // Fallback to Date parsing if format is different
        const startDateTime = new Date(onecomRecord.start);
        // Use local date instead of UTC to preserve the correct date
        const year = startDateTime.getFullYear();
        const month = String(startDateTime.getMonth() + 1).padStart(2, '0');
        const day = String(startDateTime.getDate()).padStart(2, '0');
        date = `${year}-${month}-${day}`;
        time = startDateTime.toTimeString().substring(0, 8);
      }
    } else {
      // Fallback if start is not available
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      date = `${year}-${month}-${day}`;
      time = now.toTimeString().substring(0, 8);
    }

    // Clean source data - remove "-decker" suffix and other common suffixes
    const cleanSource = (source) => {
      if (!source) return '';
      return source.replace(/-decker$/, '').replace(/-tenant$/, '').replace(/-pbx$/, '');
    };

    // Clean destination field by removing #019# prefix and other unwanted characters
    const cleanDestination = (field) => {
      if (!field) return '';
      return field.toString()
        .replace(/^#019#/, '')  // Remove #019# prefix
        .replace(/-decker$/, '')
        .replace(/-tenant$/, '')
        .replace(/-pbx$/, '')
        .trim();
    };

    // Clean incoming DID by removing duplicate numbers and extracting phone number from formatted strings
    const cleanIncomingDid = (field) => {
      if (!field) return '';
      let cleaned = field.toString().trim();
      
      // Extract phone number from formatted strings like "דויד" <+15854307664> or "Name" <phone>
      const phoneMatch = cleaned.match(/<([^>]+)>/);
      if (phoneMatch) {
        cleaned = phoneMatch[1];
      }
      
      // Remove any remaining non-numeric characters except + at the beginning
      cleaned = cleaned.replace(/[^\d+]/g, '');
      
      // Check if the number appears to be doubled (e.g., "123456123456" where "123456" is repeated)
      if (cleaned.length % 2 === 0 && cleaned.length >= 6) {
        const halfLength = cleaned.length / 2;
        const firstHalf = cleaned.substring(0, halfLength);
        const secondHalf = cleaned.substring(halfLength);
        
        // If both halves are identical, remove the duplicate
        if (firstHalf === secondHalf) {
          cleaned = firstHalf;
          console.log(`🔧 Cleaned duplicate incoming DID: ${field} -> ${cleaned}`);
        }
      }
      
      return cleaned;
    };

    const cleanSourceField = cleanSource(onecomRecord.realsrc || onecomRecord.src || '');
    const cleanDestinationField = cleanDestination(onecomRecord.lastdst || onecomRecord.dst || '');
    const cleanIncomingDidField = cleanIncomingDid(onecomRecord.clid || '');

    // Map direction based on 1com documentation and actual data
    let direction = 'unknown';
    if (onecomRecord.dcontext) {
      switch (onecomRecord.dcontext) {
        case 'fromoutside':
        case 'from-pstn':
        case 'from-external':
          direction = 'inbound';
          break;
        case 'fromotherpbx':
        case 'frominternal':
        case 'from-internal':
        case 'from-sip':
          direction = 'outbound';
          break;
        case 'from-queue':
          direction = 'queue';
          break;
        case 'from-conference':
          direction = 'conference';
          break;
        case 'from-voicemail':
          direction = 'voicemail';
          break;
        default:
          // Try to infer from source/destination patterns
          if (cleanSourceField.match(/^\d{3,4}$/)) {
            direction = 'outbound'; // Internal extension making outbound call
          } else if (cleanDestinationField.match(/^\d{3,4}$/)) {
            direction = 'inbound'; // External number calling internal extension
          } else {
            direction = 'unknown';
          }
      }
    }

    // Map status/disposition based on 1com documentation
    let status = onecomRecord.disposition || 'unknown';
    const disposition = status.toLowerCase();
    
    // Check for "no answer" FIRST before checking for "answer" to avoid conflicts
    if ((disposition.includes('no') && disposition.includes('answer')) || disposition.includes('no answer')) {
      status = 'no+answer';
    } else if (disposition.includes('answered') || disposition.includes('answer')) {
      status = 'answered';
    } else if (disposition.includes('busy')) {
      status = 'busy';
    } else if (disposition.includes('failed') || disposition.includes('congestion')) {
      status = 'failed';
    } else if (disposition.includes('cancel')) {
      status = 'cancelled';
    } else if (disposition.includes('redirect')) {
      status = 'redirected';
    }

    // Map employee_id by checking ALL call log fields (source, destination, incoming DID, etc.)
    // against ALL employee fields (phone_ext, phone, mobile, mobile_ext)
    // This ensures we don't miss any matches
    const callLogFields = [
      cleanSourceField,
      cleanDestinationField,
      cleanIncomingDidField,
      // Also check original fields before cleaning
      onecomRecord.realsrc || onecomRecord.src || '',
      onecomRecord.lastdst || onecomRecord.dst || '',
      onecomRecord.clid || '',
      // Check firstdst as well
      onecomRecord.firstdst || ''
    ].filter(field => field && field !== '' && field !== '---');

    // Remove duplicates from call log fields
    const uniqueCallLogFields = [...new Set(callLogFields.map(f => f.toString().trim()))];
    
    console.log(`🔍 Mapping employee for call ${onecomRecord.uniqueid} using fields: ${uniqueCallLogFields.join(', ')}`);
    
    // Try to match employee using all call log fields
    // Pass cached employees list to avoid repeated database queries
    let employeeId = null;
    for (const callLogField of uniqueCallLogFields) {
      employeeId = await this.mapExtensionToEmployeeId(callLogField, null, cachedEmployeesList);
      if (employeeId) {
        console.log(`✅ Matched employee ID ${employeeId} using call log field: ${callLogField}`);
        break; // Found a match, stop searching
      }
    }
    
    if (!employeeId) {
      console.log(`⚠️  No employee match found for call ${onecomRecord.uniqueid} using fields: ${uniqueCallLogFields.join(', ')}`);
    }
    
    // Map lead_id from destination number (call_logs table only supports legacy lead_id, not client_id)
    const leadMapping = await this.mapDestinationToLeadId(cleanDestinationField);
    const leadId = leadMapping.leadId; // Only use leadId for legacy leads (call_logs table structure)

    // Try to get recording URL if available
    let recordingUrl = '';
    if (onecomRecord.uniqueid) {
      try {
        // According to 1com docs, we can get recording with: 
        // https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=KEY&reqtype=INFO&info=recording&id=UNIQUEID&tenant=TENANT
        // baseUrl already includes /pbx/proxyapi.php, so don't duplicate it
        const recordingApiUrl = `${this.baseUrl}?key=${this.apiKey}&reqtype=INFO&info=recording&id=${onecomRecord.uniqueid}&tenant=${this.tenant}`;
        // Note: We'll fetch this asynchronously to avoid blocking the sync process
        recordingUrl = recordingApiUrl;
      } catch (error) {
        console.log(`Could not construct recording URL for ${onecomRecord.uniqueid}:`, error.message);
      }
    }

    return {
      id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000), // Generate unique ID (smaller number)
      call_id: onecomRecord.uniqueid || onecomRecord.call_id?.toString(),
      cdate: onecomRecord.start,
      date: date,
      time: time,
      source: cleanSourceField,
      destination: cleanDestinationField,
      incomingdid: cleanIncomingDidField,
      direction: direction,
      status: status,
      duration: onecomRecord.duration || 0,
      url: recordingUrl,
      action: onecomRecord.disposition || '',
      // Map employee_id from cleaned source extension
      employee_id: employeeId,
      // Map lead_id from destination number (only for legacy leads - call_logs table doesn't have client_id column)
      lead_id: leadId || null,
      // Store original 1com data for reference
      onecom_uniqueid: onecomRecord.uniqueid,
      onecom_te_id: onecomRecord.call_id?.toString() || '', // Convert to string to avoid integer overflow
      onecom_raw_data: JSON.stringify(onecomRecord)
    };

    return dbRecord;
  }

  /**
   * Fetch recording data from 1com API
   * @param {string} uniqueId - Unique ID from 1com call log
   * @returns {Promise<Object|null>}
   */
  async fetchRecordingData(uniqueId) {
    if (!uniqueId) return null;

    try {
      // baseUrl already includes /pbx/proxyapi.php, so don't duplicate it
      const recordingUrl = `${this.baseUrl}?key=${this.apiKey}&reqtype=INFO&info=recording&id=${uniqueId}&tenant=${this.tenant}`;
      
      console.log(`🎵 Fetching recording data for ${uniqueId}...`);
      const response = await fetch(recordingUrl);
      
      if (!response.ok) {
        console.log(`No recording available for ${uniqueId} (${response.status})`);
        return null;
      }

      const contentType = response.headers.get('content-type');
      const contentLength = response.headers.get('content-length');
      
      // If it's an audio file, return the URL
      if (contentType && contentType.includes('audio/')) {
        return {
          url: recordingUrl,
          contentType: contentType,
          size: contentLength ? parseInt(contentLength) : null,
          available: true
        };
      }

      // If it's JSON response, parse it
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        return {
          url: recordingUrl,
          data: data,
          available: true
        };
      } catch (e) {
        // If not JSON, might be plain text or HTML
        return {
          url: recordingUrl,
          text: text,
          available: true
        };
      }
    } catch (error) {
      console.error(`Error fetching recording for ${uniqueId}:`, error);
      return null;
    }
  }

  /**
   * Normalize phone number by removing country code prefixes and formatting
   * Handles Israeli phone numbers with country codes like 00, +, etc.
   * @param {string} phoneNumber - Raw phone number
   * @returns {string} - Normalized phone number (digits only)
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/[^\d]/g, '');
    
    // Handle Israeli phone numbers with country code prefixes
    // Remove common country code prefixes: 00972, 972, 00 (double zero prefix)
    if (cleaned.startsWith('00972')) {
      // Remove "00972" and add leading 0 for Israeli format
      cleaned = '0' + cleaned.substring(5);
    } else if (cleaned.startsWith('972')) {
      // Remove "972" and add leading 0 for Israeli format
      cleaned = '0' + cleaned.substring(3);
    } else if (cleaned.startsWith('00') && cleaned.length > 10) {
      // For numbers starting with "00" and longer than 10 digits, it's likely a country code
      // Remove "00" prefix, but if the result doesn't start with 0, add it for Israeli numbers
      const withoutPrefix = cleaned.substring(2);
      if (withoutPrefix.length >= 9 && !withoutPrefix.startsWith('0')) {
        // Add leading 0 if it's an Israeli number (9 digits without leading 0)
        cleaned = '0' + withoutPrefix;
      } else {
        cleaned = withoutPrefix;
      }
    }
    
    // Ensure Israeli numbers have leading 0 if they're 9 digits (without leading 0)
    // Israeli mobile/phone numbers are typically 10 digits: 0 + 9 digits
    if (cleaned.length === 9 && cleaned[0] !== '0') {
      cleaned = '0' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Map extension/phone number to employee_id automatically
   * Cross-matches ALL employee phone/mobile/extension fields (phone_ext, phone, mobile, mobile_ext) 
   * against BOTH source and incoming DID
   * @param {string} source - Extension or phone number from 1com (can be phone_ext, mobile_ext, phone, or mobile)
   * @param {string} incomingDid - Incoming DID from 1com call log
   * @returns {Promise<number|null>}
   */
  async mapExtensionToEmployeeId(source, incomingDid = null) {
    if (!source || source === '---') {
      return null;
    }

    try {
      const searchTerms = [source.toString()];
      
      // Add incoming DID to search terms if it's different from source
      if (incomingDid && incomingDid !== '---' && incomingDid !== source) {
        searchTerms.push(incomingDid.toString());
      }

      console.log(`🔍 Cross-matching employee mapping with terms: ${searchTerms.join(', ')}`);

      // Get all employees first, then do comprehensive matching in JavaScript
      // This allows us to do more complex cross-matching logic
      const { data: allEmployees, error: empError } = await supabase
        .from('tenants_employee')
        .select('id, display_name, phone_ext, phone, mobile, mobile_ext')
        .not('id', 'is', null);  // Just check that ID exists, not display_name

      if (empError) {
        console.error('Error fetching employees:', empError);
        return null;
      }

      if (!allEmployees || allEmployees.length === 0) {
        console.log('No employees found in database');
        return null;
      }

      // Comprehensive matching logic: 2-4 digits = extension, 5+ digits = phone number
      // Check ALL employee fields (phone_ext, phone, mobile, mobile_ext) against search terms
      for (const employee of allEmployees) {
        const employeeFields = [
          { value: employee.phone_ext, type: 'phone_ext' },
          { value: employee.phone, type: 'phone' },
          { value: employee.mobile, type: 'mobile' },
          { value: employee.mobile_ext, type: 'mobile_ext' }
        ].filter(field => field.value && field.value !== '' && field.value !== '\\N');

        for (const searchTerm of searchTerms) {
          // Normalize and clean the search term
          const normalizedSearch = this.normalizePhoneNumber(searchTerm);
          
          // Determine if this is an extension (2-4 digits) or phone number (5+ digits)
          const isExtension = normalizedSearch.length >= 2 && normalizedSearch.length <= 4;
          
          for (const field of employeeFields) {
            const normalizedField = this.normalizePhoneNumber(field.value);
            
            if (isExtension) {
              // Extension matching: 2-4 digits, exact match or partial match
              // Try exact match first
              if (normalizedField === normalizedSearch) {
                console.log(`✅ Employee matched: ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
              // Try partial match: check if search term is contained in field or vice versa
              if (normalizedField.length >= normalizedSearch.length && normalizedField.slice(-normalizedSearch.length) === normalizedSearch) {
                console.log(`✅ Employee matched (partial): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
              if (normalizedSearch.length >= normalizedField.length && normalizedSearch.slice(-normalizedField.length) === normalizedField) {
                console.log(`✅ Employee matched (reverse partial): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
            } else {
              // Phone number matching: 5+ digits, match last 5 digits
              if (normalizedField.length >= 5 && normalizedSearch.length >= 5) {
                if (normalizedField.slice(-5) === normalizedSearch.slice(-5)) {
                  console.log(`✅ Employee matched (phone last 5): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                  return employee.id;
                }
              } else if (normalizedField.length >= 4 && normalizedSearch.length >= 4) {
                // Fallback to last 4 digits if one is shorter than 5
                if (normalizedField.slice(-4) === normalizedSearch.slice(-4)) {
                  console.log(`✅ Employee matched (phone last 4): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                  return employee.id;
                }
              }
              // Also try exact match for phone numbers
              if (normalizedField === normalizedSearch) {
                console.log(`✅ Employee matched (phone exact): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`Error mapping ${source}:`, error);
      return null;
    }
  }

  /**
   * Helper function to normalize phone number (remove all non-digits)
   * @param {string} phone - Phone number to normalize
   * @returns {string} - Normalized phone number
   */
  normalizePhone(phone) {
    if (!phone || phone === null || phone === '') return '';
    return phone.replace(/\D/g, '');
  }

  /**
   * Helper function to parse additional_phones field (can be JSON array or comma-separated string)
   * @param {string} value - additional_phones field value
   * @returns {Array<string>} - Array of phone numbers
   */
  parseAdditionalPhones(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
      }
      if (typeof parsed === 'string') {
        return parsed.split(/[,;|\s]+/).map(item => item.trim()).filter(Boolean);
      }
    } catch (error) {
      // Not JSON, fall back to string parsing
    }
    return value.split(/[,;|\s]+/).map(item => item.trim()).filter(Boolean);
  }

  /**
   * Pick preferred lead link when contact is linked to multiple leads
   * Prioritizes new leads over legacy leads, and main contacts
   * @param {Array} links - Array of lead_leadcontact records
   * @returns {Object|null} - Preferred link or null
   */
  pickPreferredLeadLink(links) {
    if (!links || links.length === 0) return null;
    
    // Sort: new leads first, then legacy leads; main contacts first
    return [...links].sort((a, b) => {
      // Prioritize new leads
      if (a.newlead_id && !b.newlead_id) return -1;
      if (!a.newlead_id && b.newlead_id) return 1;
      
      // Prioritize main contacts
      if (a.main === 'true' && b.main !== 'true') return -1;
      if (a.main !== 'true' && b.main === 'true') return 1;
      
      return 0;
    })[0];
  }

  /**
   * Map destination phone number to lead_id (using comprehensive matching)
   * Checks both main lead phone numbers, lead_number, and contacts for new and legacy leads
   * @param {string} destination - Destination phone number from 1com
   * @returns {Promise<{leadId: number|null, clientId: string|null}>}
   */
  async mapDestinationToLeadId(destination) {
    if (!destination || destination === '---') {
      return { leadId: null, clientId: null };
    }

    try {
      // Use the better normalizePhoneNumber function that handles country codes properly
      const incomingNormalized = this.normalizePhoneNumber(destination);
      
      // Create comprehensive set of normalized variations for matching
      const normalizedSet = new Set();
      
      // Add the primary normalized version
      if (incomingNormalized) {
        normalizedSet.add(incomingNormalized);
        
        // Add variations for matching
        // Without leading 0 (Israeli format)
        if (incomingNormalized.startsWith('0') && incomingNormalized.length > 1) {
          normalizedSet.add(incomingNormalized.substring(1));
        }
        // With leading 0 (if doesn't have it)
        if (!incomingNormalized.startsWith('0') && incomingNormalized.length === 9) {
          normalizedSet.add('0' + incomingNormalized);
        }
        // With country code 972
        if (incomingNormalized.startsWith('0')) {
          normalizedSet.add('972' + incomingNormalized.substring(1));
        } else {
          normalizedSet.add('972' + incomingNormalized);
        }
        // Last 9, 8, 7, 5 digits for partial matching
        if (incomingNormalized.length >= 9) normalizedSet.add(incomingNormalized.slice(-9));
        if (incomingNormalized.length >= 8) normalizedSet.add(incomingNormalized.slice(-8));
        if (incomingNormalized.length >= 7) normalizedSet.add(incomingNormalized.slice(-7));
        if (incomingNormalized.length >= 5) normalizedSet.add(incomingNormalized.slice(-5));
      }
      
      // Also add raw destination and simple digit-only version
      normalizedSet.add(destination.replace(/\D/g, ''));
      
      // Create raw search values for .in() queries (keep original formats)
      const rawSearchValues = [destination];
      if (incomingNormalized) {
        rawSearchValues.push(incomingNormalized);
        if (incomingNormalized.startsWith('0')) {
          rawSearchValues.push(incomingNormalized.substring(1));
          rawSearchValues.push('972' + incomingNormalized.substring(1));
        }
      }
      const uniqueRawSearchValues = Array.from(new Set(rawSearchValues.filter(Boolean)));

      console.log(`🔍 Mapping destination "${destination}" -> normalized: "${incomingNormalized}", ${normalizedSet.size} variations`);

      if (!incomingNormalized || incomingNormalized.length < 5) {
        console.log(`❌ Destination too short for phone matching (need 5+ digits): ${incomingNormalized || 'empty'}`);
        return { leadId: null, clientId: null };
      }

      const contactSelectColumns = `
        id,
        name,
        phone,
        mobile,
        additional_phones,
        newlead_id,
        lead_leadcontact (
          lead_id,
          newlead_id,
          main
        )
      `;

      const contactCandidatesMap = new Map();
      const addContacts = (rows) => {
        (rows || []).forEach(row => {
          if (!contactCandidatesMap.has(row.id)) {
            contactCandidatesMap.set(row.id, row);
          }
        });
      };

      // Store direct lead matches for fallback if no contacts found
      let directNewLeadMatch = null;
      let directLegacyLeadMatch = null;

      // Helper function to check if a phone number matches (with multiple strategies)
      const phoneMatches = (dbPhone, searchNormalized) => {
        if (!dbPhone || !searchNormalized) return false;
        const dbNormalized = this.normalizePhoneNumber(dbPhone);
        if (!dbNormalized) return false;
        
        // Try exact match first
        if (dbNormalized === searchNormalized) return true;
        
        // Try variations (without/with leading 0, with country code)
        const dbVariations = [
          dbNormalized,
          dbNormalized.startsWith('0') ? dbNormalized.substring(1) : '0' + dbNormalized,
          dbNormalized.startsWith('0') ? '972' + dbNormalized.substring(1) : dbNormalized,
          dbNormalized.startsWith('972') ? '0' + dbNormalized.substring(3) : dbNormalized,
        ];
        if (dbVariations.includes(searchNormalized)) return true;
        
        // Try partial matches (last 9, 8, 7, 5 digits)
        if (searchNormalized.length >= 9 && dbNormalized.length >= 9) {
          if (dbNormalized.slice(-9) === searchNormalized.slice(-9)) return true;
        }
        if (searchNormalized.length >= 8 && dbNormalized.length >= 8) {
          if (dbNormalized.slice(-8) === searchNormalized.slice(-8)) return true;
        }
        if (searchNormalized.length >= 7 && dbNormalized.length >= 7) {
          if (dbNormalized.slice(-7) === searchNormalized.slice(-7)) return true;
        }
        if (searchNormalized.length >= 5 && dbNormalized.length >= 5) {
          if (dbNormalized.slice(-5) === searchNormalized.slice(-5)) return true;
        }
        
        return false;
      };

      // STEP 1: Try exact matches in contacts using .in() queries (fastest)
      if (uniqueRawSearchValues.length > 0) {
        const { data: phoneMatchesData } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .in('phone', uniqueRawSearchValues);
        if (phoneMatchesData) addContacts(phoneMatchesData);

        const { data: mobileMatchesData } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .in('mobile', uniqueRawSearchValues);
        if (mobileMatchesData) addContacts(mobileMatchesData);
      }

      // STEP 1.5: Try direct matching against new leads (phone, mobile, lead_number) - only if no contacts found yet
      // Use targeted queries first, then fall back to broader search if needed
      if (!directNewLeadMatch && !contactCandidatesMap.size) {
        // First try exact matches using .in() queries (faster)
        if (uniqueRawSearchValues.length > 0) {
          const { data: exactPhoneMatches } = await supabase
            .from('leads')
            .select('id, name, phone, mobile, lead_number')
            .in('phone', uniqueRawSearchValues)
            .limit(10);
          if (exactPhoneMatches && exactPhoneMatches.length > 0) {
            directNewLeadMatch = exactPhoneMatches[0];
            console.log(`✅ DIRECT NEW LEAD match (exact phone): destination "${destination}" -> new lead "${directNewLeadMatch.name}" (ID: ${directNewLeadMatch.id})`);
          }
          
          if (!directNewLeadMatch) {
            const { data: exactMobileMatches } = await supabase
              .from('leads')
              .select('id, name, phone, mobile, lead_number')
              .in('mobile', uniqueRawSearchValues)
              .limit(10);
            if (exactMobileMatches && exactMobileMatches.length > 0) {
              directNewLeadMatch = exactMobileMatches[0];
              console.log(`✅ DIRECT NEW LEAD match (exact mobile): destination "${destination}" -> new lead "${directNewLeadMatch.name}" (ID: ${directNewLeadMatch.id})`);
            }
          }
          
          // Also try matching against lead_number (only for values that look like phone numbers)
          if (!directNewLeadMatch) {
            const phoneLikeValues = uniqueRawSearchValues.filter(v => {
              const digitsOnly = v.replace(/\D/g, '');
              return digitsOnly.length >= 5;
            });
            if (phoneLikeValues.length > 0) {
              const { data: exactLeadNumberMatches } = await supabase
                .from('leads')
                .select('id, name, phone, mobile, lead_number')
                .in('lead_number', phoneLikeValues)
                .limit(10);
              if (exactLeadNumberMatches && exactLeadNumberMatches.length > 0) {
                // Verify it's actually a phone number match
                for (const lead of exactLeadNumberMatches) {
                  if (lead.lead_number) {
                    const leadNumberNormalized = this.normalizePhoneNumber(lead.lead_number);
                    if (leadNumberNormalized && phoneMatches(leadNumberNormalized, incomingNormalized)) {
                      directNewLeadMatch = lead;
                      console.log(`✅ DIRECT NEW LEAD match (exact lead_number): destination "${destination}" -> new lead "${lead.name}" (ID: ${lead.id}) via lead_number: ${lead.lead_number}`);
                      break;
                    }
                  }
                }
              }
            }
          }
        }
        
        // If no exact match, try partial matching with last digits (more targeted than fetching all leads)
        if (!directNewLeadMatch && incomingNormalized.length >= 8) {
          const last8Digits = incomingNormalized.slice(-8);
          const { data: partialMatches } = await supabase
            .from('leads')
            .select('id, name, phone, mobile, lead_number')
            .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,lead_number.ilike.%${last8Digits}%`)
            .limit(50);
          
          if (partialMatches) {
            for (const lead of partialMatches) {
              // Verify match using phoneMatches helper
              if ((lead.phone && phoneMatches(lead.phone, incomingNormalized)) ||
                  (lead.mobile && phoneMatches(lead.mobile, incomingNormalized))) {
                directNewLeadMatch = lead;
                console.log(`✅ DIRECT NEW LEAD match (partial): destination "${destination}" -> new lead "${lead.name}" (ID: ${lead.id})`);
                break;
              }
              // Check lead_number - only if it looks like a phone number (mostly digits, 5+ chars)
              if (lead.lead_number) {
                const leadNumberDigits = lead.lead_number.replace(/\D/g, '');
                if (leadNumberDigits.length >= 5) {
                  const leadNumberNormalized = this.normalizePhoneNumber(lead.lead_number);
                  if (leadNumberNormalized && phoneMatches(leadNumberNormalized, incomingNormalized)) {
                    directNewLeadMatch = lead;
                    console.log(`✅ DIRECT NEW LEAD match (lead_number): destination "${destination}" -> new lead "${lead.name}" (ID: ${lead.id}) via lead_number: ${lead.lead_number}`);
                    break;
                  }
                }
              }
            }
          }
        }
      }

      // STEP 1.6: Try direct matching against legacy leads (phone, mobile, lead_number which is the ID)
      if (!directLegacyLeadMatch && !contactCandidatesMap.size) {
        // First try exact matches using .in() queries (faster)
        if (uniqueRawSearchValues.length > 0) {
          const { data: exactLegacyPhoneMatches } = await supabase
            .from('leads_lead')
            .select('id, name, phone, mobile, additional_phones')
            .in('phone', uniqueRawSearchValues)
            .limit(10);
          if (exactLegacyPhoneMatches && exactLegacyPhoneMatches.length > 0) {
            directLegacyLeadMatch = exactLegacyPhoneMatches[0];
            console.log(`✅ DIRECT LEGACY LEAD match (exact phone): destination "${destination}" -> legacy lead "${directLegacyLeadMatch.name}" (ID: ${directLegacyLeadMatch.id})`);
          }
          
          if (!directLegacyLeadMatch) {
            const { data: exactLegacyMobileMatches } = await supabase
              .from('leads_lead')
              .select('id, name, phone, mobile, additional_phones')
              .in('mobile', uniqueRawSearchValues)
              .limit(10);
            if (exactLegacyMobileMatches && exactLegacyMobileMatches.length > 0) {
              directLegacyLeadMatch = exactLegacyMobileMatches[0];
              console.log(`✅ DIRECT LEGACY LEAD match (exact mobile): destination "${destination}" -> legacy lead "${directLegacyLeadMatch.name}" (ID: ${directLegacyLeadMatch.id})`);
            }
          }
        }
        
        // If no exact match, try partial matching with last digits
        if (!directLegacyLeadMatch && incomingNormalized.length >= 8) {
          const last8Digits = incomingNormalized.slice(-8);
          const { data: partialLegacyMatches } = await supabase
            .from('leads_lead')
            .select('id, name, phone, mobile, additional_phones')
            .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`)
            .limit(50);
          
          if (partialLegacyMatches) {
            for (const lead of partialLegacyMatches) {
              // Verify match using phoneMatches helper
              if ((lead.phone && phoneMatches(lead.phone, incomingNormalized)) ||
                  (lead.mobile && phoneMatches(lead.mobile, incomingNormalized))) {
                directLegacyLeadMatch = lead;
                console.log(`✅ DIRECT LEGACY LEAD match (partial): destination "${destination}" -> legacy lead "${lead.name}" (ID: ${lead.id})`);
                break;
              }
              // Check additional_phones
              if (lead.additional_phones) {
                const additionalPhones = this.parseAdditionalPhones(lead.additional_phones);
                if (additionalPhones.some(ap => phoneMatches(ap, incomingNormalized))) {
                  directLegacyLeadMatch = lead;
                  console.log(`✅ DIRECT LEGACY LEAD match (additional_phone): destination "${destination}" -> legacy lead "${lead.name}" (ID: ${lead.id})`);
                  break;
                }
              }
              // Check ID (lead_number for legacy leads)
              if (lead.id) {
                const leadIdStr = String(lead.id);
                const leadIdNormalized = this.normalizePhoneNumber(leadIdStr);
                if (leadIdNormalized && phoneMatches(leadIdNormalized, incomingNormalized)) {
                  directLegacyLeadMatch = lead;
                  console.log(`✅ DIRECT LEGACY LEAD match (ID): destination "${destination}" -> legacy lead "${lead.name}" (ID: ${lead.id})`);
                  break;
                }
              }
            }
          }
        }
      }

      // STEP 2: If no exact matches found, try partial matching using multiple digit lengths
      if (!contactCandidatesMap.size) {
        console.log(`📞 No exact contact matches, trying partial matching with last 9/8/7/5 digits`);
        
        // Try multiple partial match strategies (last 9, 8, 7, 5 digits)
        const partialLengths = [];
        if (incomingNormalized.length >= 9) partialLengths.push(9);
        if (incomingNormalized.length >= 8) partialLengths.push(8);
        if (incomingNormalized.length >= 7) partialLengths.push(7);
        if (incomingNormalized.length >= 5) partialLengths.push(5);
        
        for (const length of partialLengths) {
          const lastDigits = incomingNormalized.slice(-length);
          const { data: contactPartialMatches } = await supabase
            .from('leads_contact')
            .select(contactSelectColumns)
            .or(`phone.ilike.%${lastDigits}%,mobile.ilike.%${lastDigits}%,additional_phones.ilike.%${lastDigits}%`)
            .limit(100);
          if (contactPartialMatches && contactPartialMatches.length > 0) {
            addContacts(contactPartialMatches);
            console.log(`📞 Found ${contactPartialMatches.length} contact(s) with last ${length} digits match: ${lastDigits}`);
            break; // Stop after first successful partial match
          }
        }
      }

      // STEP 3: Process contact candidates with better normalization using phoneMatches helper
      const candidates = Array.from(contactCandidatesMap.values());
      for (const contact of candidates) {
        const contactPhones = [
          contact.phone,
          contact.mobile,
          ...this.parseAdditionalPhones(contact.additional_phones || '')
        ].filter(Boolean);

        // Check if any contact phone matches the incoming phone using phoneMatches helper
        const hasMatch = contactPhones.some(contactPhone => phoneMatches(contactPhone, incomingNormalized));
        
        if (!hasMatch) continue;

        const preferredLink = this.pickPreferredLeadLink(contact.lead_leadcontact || []);
        let leadData = null;
        let leadType = null;

        // Try new lead first
        if (preferredLink && preferredLink.newlead_id) {
          const { data: newLead } = await supabase
            .from('leads')
            .select('id, name, phone, mobile')
            .eq('id', preferredLink.newlead_id)
            .maybeSingle();
          if (newLead) {
            leadData = newLead;
            leadType = 'new';
          }
        }

        // Try legacy lead if new lead not found
        if (!leadData && preferredLink && preferredLink.lead_id) {
          const { data: legacyLead } = await supabase
            .from('leads_lead')
            .select('id, name, phone, mobile')
            .eq('id', preferredLink.lead_id)
            .maybeSingle();
          if (legacyLead) {
            leadData = legacyLead;
            leadType = 'legacy';
          }
        }

        // Fallback: use contact's newlead_id if no preferred link
        if (!leadData && contact.newlead_id) {
          const { data: fallbackLead } = await supabase
            .from('leads')
            .select('id, name, phone, mobile')
            .eq('id', contact.newlead_id)
            .maybeSingle();
          if (fallbackLead) {
            leadData = fallbackLead;
            leadType = 'new';
          }
        }

        if (leadData) {
          console.log(`✅ CONTACT -> ${leadType.toUpperCase()} LEAD match: destination "${destination}" -> contact "${contact.name}" -> ${leadType} lead "${leadData.name}" (ID: ${leadData.id})`);
          return leadType === 'new' 
            ? { leadId: null, clientId: leadData.id }
            : { leadId: leadData.id, clientId: null };
        }
      }

      // STEP 4: Return direct lead matches (prioritize new leads)
      if (directNewLeadMatch) {
        return { leadId: null, clientId: directNewLeadMatch.id };
      }
      
      if (directLegacyLeadMatch) {
        return { leadId: directLegacyLeadMatch.id, clientId: null };
      }

      console.log(`❌ No lead mapping found for destination "${destination}" (normalized: "${incomingNormalized}")`);
      return { leadId: null, clientId: null };
    } catch (error) {
      console.error(`Error mapping destination "${destination}":`, error);
      return { leadId: null, clientId: null };
    }
  }

  /**
   * Sync call logs from 1com to database
   * @param {string} startDate - Start date in YYYY-MM-DD format
   * @param {string} endDate - End date in YYYY-MM-DD format
   * @param {string} extensions - Comma-separated list of extensions (optional)
   * @param {Date} minimumTime - Optional: Only process calls after this time (for webhook optimization)
   * @returns {Promise<Object>}
   */
  async syncCallLogs(startDate, endDate, extensions = null, minimumTime = null) {
    try {
      console.log(`🔄 DEBUG: Starting call logs sync from ${startDate} to ${endDate}`);
      console.log(`🔄 DEBUG: Extensions: ${extensions}`);
      
      // Fetch data from 1com
      console.log(`🔄 DEBUG: Calling fetchCallLogsFromOneCom...`);
      const onecomResponse = await this.fetchCallLogsFromOneCom(startDate, endDate, extensions);
      
      console.log(`🔄 DEBUG: Onecom response:`, {
        success: onecomResponse.success,
        error: onecomResponse.error,
        message: onecomResponse.message,
        dataLength: onecomResponse.data ? onecomResponse.data.length : 0
      });
      
      if (!onecomResponse.success) {
        console.log(`❌ DEBUG: Fetch failed:`, onecomResponse.error);
        return {
          success: false,
          error: onecomResponse.error,
          message: onecomResponse.message
        };
      }

      let onecomRecords = onecomResponse.data;
      if (!onecomRecords || onecomRecords.length === 0) {
        console.log(`📊 DEBUG: No records found, returning success with 0 synced`);
        return {
          success: true,
          message: 'No call logs found for the specified date range',
          synced: 0,
          skipped: 0
        };
      }

      console.log(`📊 DEBUG: Found ${onecomRecords.length} call logs from 1com before filtering`);

      // Check what's already in the database for today (for comparison)
      const today = new Date().toISOString().split('T')[0];
      try {
        const { data: dbTodayCalls, error: dbError } = await supabase
          .from('call_logs')
          .select('id, onecom_uniqueid, date, time, cdate')
          .eq('date', today)
          .limit(10);
        
        if (!dbError && dbTodayCalls) {
          console.log(`💾 DEBUG: Found ${dbTodayCalls.length} call log(s) in database for today (${today}) - sample shown`);
          if (dbTodayCalls.length > 0) {
            console.log(`💾 DEBUG: Sample DB records for today:`, dbTodayCalls.slice(0, 3).map(r => ({
              uniqueid: r.onecom_uniqueid,
              date: r.date,
              time: r.time,
              has_cdate: !!r.cdate
            })));
          }
        }
      } catch (dbCheckError) {
        console.error(`⚠️ Error checking DB for today's calls:`, dbCheckError);
      }

      // Analyze date distribution in the response - check ALL records, not just first 50
      if (onecomRecords.length > 0) {
        const dateCounts = {};
        let todayCount = 0;
        
        onecomRecords.forEach(record => {
          if (record.start) {
            const dateOnly = record.start.split(' ')[0]; // Extract YYYY-MM-DD
            dateCounts[dateOnly] = (dateCounts[dateOnly] || 0) + 1;
            if (dateOnly === today) {
              todayCount++;
            }
          }
        });
        
        console.log(`📅 DEBUG: Date distribution (all ${onecomRecords.length} records):`, dateCounts);
        console.log(`📅 DEBUG: Calls from today (${today}) in API response: ${todayCount} out of ${onecomRecords.length}`);
        
        // Show sample of today's calls if any
        if (todayCount > 0) {
          const todayCalls = onecomRecords.filter(r => r.start && r.start.startsWith(today)).slice(0, 5);
          console.log(`📅 DEBUG: Sample of today's calls from API (first 5):`, todayCalls.map(r => ({ uniqueid: r.uniqueid, start: r.start })));
        } else {
          console.log(`⚠️  DEBUG: OneCom API returned 0 calls for today (${today}), but calls may exist in database from previous syncs`);
        }
      }

      // Filter records by date range (in case API doesn't filter properly or returns all records)
      if (startDate && endDate) {
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T23:59:59');
        
        let filteredOut = 0;
        onecomRecords = onecomRecords.filter(record => {
          if (!record.start) return false;
          
          try {
            // Parse the start date from the record (format: "2025-12-13 01:35:47")
            const recordDate = new Date(record.start.replace(' ', 'T'));
            
            // Check if record date is within range
            const isInRange = recordDate >= start && recordDate <= end;
            
            if (!isInRange) {
              filteredOut++;
              if (filteredOut <= 5) { // Only log first 5 to avoid spam
                console.log(`📅 Filtering out record ${record.uniqueid} - date ${record.start} is outside range ${startDate} to ${endDate}`);
              }
            }
            
            return isInRange;
          } catch (error) {
            console.error(`❌ Error parsing date for record ${record.uniqueid}:`, error);
            return false;
          }
        });
        
        if (filteredOut > 5) {
          console.log(`📅 ... and ${filteredOut - 5} more records filtered out`);
        }
        
        console.log(`📊 DEBUG: After date filtering: ${onecomRecords.length} call logs remain (${filteredOut} filtered out)`);
      }

      // Filter by minimum time if provided (for webhook optimization - only process recent calls)
      if (minimumTime) {
        const beforeTimeFilter = onecomRecords.length;
        let timeFilteredOut = 0;
        
        onecomRecords = onecomRecords.filter(record => {
          if (!record.start) return false;
          
          try {
            // Parse the start date/time from the record (format: "2025-12-13 01:35:47")
            const recordDate = new Date(record.start.replace(' ', 'T'));
            
            // Only include records after minimumTime
            const isAfterMinTime = recordDate >= minimumTime;
            
            if (!isAfterMinTime) {
              timeFilteredOut++;
            }
            
            return isAfterMinTime;
          } catch (error) {
            console.error(`❌ Error parsing date for time filter record ${record.uniqueid}:`, error);
            return false;
          }
        });
        
        console.log(`⏰ DEBUG: After time filtering (last 2 hours since ${minimumTime.toISOString()}): ${onecomRecords.length} call logs remain (${timeFilteredOut} filtered out from ${beforeTimeFilter} total)`);
      }

      // Filter by extension/phone client-side (OneCom API phone parameter doesn't work reliably)
      // This matches both extension (2-4 digits) and phone numbers (5+ digits, match last 5)
      if (extensions) {
        const extensionList = extensions.split(',').map(ext => ext.trim()).filter(Boolean);
        console.log(`📞 DEBUG: Filtering client-side by extensions/phones: ${extensionList.join(', ')}`);
        
        // Normalize phone numbers (remove all non-digits)
        const normalizePhone = (phone) => {
          if (!phone) return '';
          return phone.toString().replace(/\D/g, '');
        };
        
        const beforeExtensionFilter = onecomRecords.length;
        onecomRecords = onecomRecords.filter(record => {
          // Check multiple fields where extension/phone might appear
          const checkFields = [
            record.src,
            record.realsrc,
            record.firstdst,
            record.dst,
            record.lastdst,
            record.srcchannel ? record.srcchannel.split('/')[1]?.split('-')[0] : null, // Extract from SIP/214-decker-...
            record.dstchannel ? record.dstchannel.split('/')[1]?.split('-')[0] : null
          ].filter(Boolean);
          
          // Check if any extension/phone matches any of the record fields
          for (const searchTerm of extensionList) {
            const normalizedSearch = normalizePhone(searchTerm);
            const isExtension = normalizedSearch.length >= 2 && normalizedSearch.length <= 4;
            
            for (const field of checkFields) {
              const fieldStr = field.toString().trim();
              const normalizedField = normalizePhone(fieldStr);
              
              // Extension matching (2-4 digits): exact match or substring match
              if (isExtension) {
                // Exact match
                if (normalizedField === normalizedSearch) {
                  console.log(`✅ DEBUG: Extension ${searchTerm} exact matched in field: ${field} (record: ${record.uniqueid})`);
                  return true;
                }
                // Field contains extension (handles cases like "214-decker")
                if (fieldStr === searchTerm || 
                    fieldStr.startsWith(searchTerm + '-') ||
                    fieldStr.includes('-' + searchTerm + '-') ||
                    fieldStr.endsWith('-' + searchTerm)) {
                  console.log(`✅ DEBUG: Extension ${searchTerm} substring matched in field: ${field} (record: ${record.uniqueid})`);
                  return true;
                }
                // Normalized partial match (bidirectional - handles 2-digit mobile_ext matching 3-digit extensions)
                // Check if longer field ends with shorter search term
                if (normalizedField.length >= normalizedSearch.length && 
                    normalizedField.slice(-normalizedSearch.length) === normalizedSearch) {
                  console.log(`✅ DEBUG: Extension ${searchTerm} normalized partial matched in field: ${field} (record: ${record.uniqueid})`);
                  return true;
                }
                // Check if longer search term ends with shorter field (handles 2-digit mobile_ext)
                if (normalizedSearch.length >= normalizedField.length && 
                    normalizedSearch.slice(-normalizedField.length) === normalizedField) {
                  console.log(`✅ DEBUG: Extension ${searchTerm} reverse partial matched in field: ${field} (record: ${record.uniqueid})`);
                  return true;
                }
              } else {
                // Phone number matching (5+ digits): match last 5 digits
                if (normalizedField.length >= 5 && normalizedSearch.length >= 5) {
                  if (normalizedField.slice(-5) === normalizedSearch.slice(-5)) {
                    console.log(`✅ DEBUG: Phone ${searchTerm} matched (last 5 digits) in field: ${field} (record: ${record.uniqueid})`);
                    return true;
                  }
                } else if (normalizedField.length >= 4 && normalizedSearch.length >= 4) {
                  // Fallback to last 4 digits if one is shorter than 5
                  if (normalizedField.slice(-4) === normalizedSearch.slice(-4)) {
                    console.log(`✅ DEBUG: Phone ${searchTerm} matched (last 4 digits) in field: ${field} (record: ${record.uniqueid})`);
                    return true;
                  }
                }
                // Also try exact match for phone numbers
                if (normalizedField === normalizedSearch) {
                  console.log(`✅ DEBUG: Phone ${searchTerm} exact matched in field: ${field} (record: ${record.uniqueid})`);
                  return true;
                }
              }
            }
          }
          
          return false;
        });
        
        console.log(`📞 DEBUG: After extension/phone filtering: ${onecomRecords.length} call logs remain (filtered from ${beforeExtensionFilter})`);
      }

      if (onecomRecords.length === 0) {
        console.log(`📊 DEBUG: No records found after date filtering`);
        return {
          success: true,
          message: 'No call logs found for the specified date range',
          synced: 0,
          skipped: 0
        };
      }

      // Map and insert records
      let synced = 0;
      let skipped = 0;
      const errors = [];
      
      // Get today's date for tracking (reused in summary)
      const todayDateStr = new Date().toISOString().split('T')[0];
      
      // Track today's calls specifically
      let todaySkipped = 0;
      let todaySynced = 0;
      
      // Log summary before processing
      console.log(`📊 DEBUG: Processing ${onecomRecords.length} filtered call logs for insertion/update check`);

      // Cache employee list to avoid fetching multiple times during mapping
      // This improves performance when processing many call logs
      let cachedEmployees = null;
      const getCachedEmployees = async () => {
        if (cachedEmployees === null) {
          const { data: allEmployees, error: empError } = await supabase
            .from('tenants_employee')
            .select('id, display_name, phone_ext, phone, mobile, mobile_ext')
            .not('id', 'is', null);
          
          if (empError) {
            console.error('Error fetching employees for caching:', empError);
            cachedEmployees = [];
          } else {
            cachedEmployees = allEmployees || [];
            console.log(`📋 Cached ${cachedEmployees.length} employees for matching`);
          }
        }
        return cachedEmployees;
      };
      
      for (const onecomRecord of onecomRecords) {
        try {
          const isTodayCall = onecomRecord.start && onecomRecord.start.startsWith(todayDateStr);
          
          // Check if record already exists
          const { data: existingRecord, error: checkError } = await supabase
            .from('call_logs')
            .select('id, cdate, date, time, source, destination')
            .eq('onecom_uniqueid', onecomRecord.uniqueid)
            .single();

          if (checkError && checkError.code !== 'PGRST116') {
            // PGRST116 = no rows found (expected for new records)
            console.error(`⚠️ Error checking for existing record ${onecomRecord.uniqueid}:`, checkError);
          }

          if (existingRecord) {
            // Log first few skipped records with details, then summarize
            if (skipped < 5) {
              console.log(`⏭️ Skipping existing record: ${onecomRecord.uniqueid} (db date: ${existingRecord.date || 'NULL'}, db time: ${existingRecord.time || 'NULL'}, call date: ${onecomRecord.start || 'N/A'})`);
            } else if (skipped === 5) {
              console.log(`⏭️ ... (skipping remaining existing records, will show summary at end)`);
            }
            skipped++;
            if (isTodayCall) {
              todaySkipped++;
            }
            continue;
          }

          // Map to database schema (async)
          const dbRecord = await this.mapOneComToDatabase(onecomRecord);
          
          const { error } = await supabase
            .from('call_logs')
            .insert([dbRecord]);

          if (error) {
            console.error(`❌ Error inserting record ${onecomRecord.uniqueid}:`, error);
            if (isTodayCall) {
              console.error(`   ⚠️ This was a call from today (${todayDateStr})`);
            }
            errors.push({
              uniqueid: onecomRecord.uniqueid,
              error: error.message
            });
          } else {
            console.log(`✅ Synced record: ${onecomRecord.uniqueid}${isTodayCall ? ` (today: ${todayDateStr})` : ''}`);
            synced++;
            if (isTodayCall) {
              todaySynced++;
            }
          }
        } catch (recordError) {
          console.error(`❌ Error processing record ${onecomRecord.uniqueid}:`, recordError);
          errors.push({
            uniqueid: onecomRecord.uniqueid,
            error: recordError.message
          });
        }
      }

      // Log final summary with more details
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 SYNC SUMMARY`);
      console.log(`${'='.repeat(80)}`);
      console.log(`✅ Synced (new records inserted): ${synced}`);
      console.log(`⏭️  Skipped (already in database): ${skipped}`);
      console.log(`❌ Errors: ${errors.length}`);
      
      // Show breakdown for today's calls
      const todayCallsInResponse = onecomRecords.filter(r => r.start && r.start.startsWith(todayDateStr)).length;
      if (todayCallsInResponse > 0) {
        console.log(`\n📅 TODAY'S CALLS BREAKDOWN (${todayDateStr}):`);
        console.log(`   - Total in API response: ${todayCallsInResponse}`);
        console.log(`   - New records inserted: ${todaySynced}`);
        console.log(`   - Skipped (already in DB): ${todaySkipped}`);
        if (todaySynced === 0 && todaySkipped === todayCallsInResponse) {
          console.log(`   ⚠️  All ${todayCallsInResponse} calls from today were already in the database`);
        } else if (todaySynced > 0) {
          console.log(`   ✅ Successfully inserted ${todaySynced} new call(s) from today`);
        }
      }
      
      console.log(`${'='.repeat(80)}\n`);
      
      if (synced === 0 && skipped > 0) {
        console.log(`ℹ️  All ${skipped} call log(s) from API were already in database (no duplicates inserted)`);
        
        // Check if there were any calls from today in the API response
        const todayCheck = new Date().toISOString().split('T')[0];
        const todayCallsInApi = onecomRecords.filter(r => r.start && r.start.startsWith(todayCheck)).length;
        
        if (todayCallsInApi === 0) {
          // Check DB for today's calls to compare
          try {
            const { count: dbTodayCount } = await supabase
              .from('call_logs')
              .select('*', { count: 'exact', head: true })
              .eq('date', todayCheck);
            
            if (dbTodayCount && dbTodayCount > 0) {
              console.log(`💡 OneCom API returned 0 calls for today (${todayCheck}), but ${dbTodayCount} call(s) already exist in database`);
              console.log(`💡 This is expected - OneCom's API may not return today's calls immediately, or only returns completed days`);
              console.log(`💡 The existing calls in DB were likely saved earlier when they were available from the API`);
            }
          } catch (dbCheckErr) {
            // Ignore error, just log the API situation
            console.log(`💡 OneCom API returned 0 calls for today - they may not be available yet in the API`);
          }
        } else {
          console.log(`💡 This is normal if calls were synced previously.`);
        }
      }
      if (synced > 0) {
        console.log(`✅ Successfully inserted ${synced} new call log record(s)`);
      }
      if (errors.length > 0) {
        console.error(`❌ Encountered ${errors.length} error(s) during sync`);
        errors.slice(0, 5).forEach((err, idx) => {
          console.error(`   Error ${idx + 1}: ${err.uniqueid || 'unknown'} - ${err.error}`);
        });
        if (errors.length > 5) {
          console.error(`   ... and ${errors.length - 5} more errors`);
        }
      }

      return {
        success: true,
        message: `Sync completed: ${synced} synced, ${skipped} skipped, ${errors.length} errors`,
        synced,
        skipped,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error('❌ Error in sync process:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred during sync'
      };
    }
  }

  /**
   * Test 1com API connection
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      const params = new URLSearchParams({
        key: this.apiKey,
        reqtype: 'HELP'
      });

      const url = `${this.baseUrl}?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/plain, application/json',
          'User-Agent': 'RMQ-CRM/1.0'
        }
      });

      return response.ok;
    } catch (error) {
      console.error('❌ Error testing 1com connection:', error);
      return false;
    }
  }

  /**
   * Get available extensions from 1com
   * @returns {Promise<Array>}
   */
  async getExtensions() {
    try {
      const params = new URLSearchParams({
        key: this.apiKey,
        reqtype: 'MANAGEDB',
        object: 'extension',
        action: 'list',
        tenant: this.tenant
      });

      const url = `${this.baseUrl}?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'RMQ-CRM/1.0'
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      
      // Extract extension numbers from the response
      if (Array.isArray(data)) {
        return data.map((ext) => ext.ex_number || ext.number || ext.id).filter(Boolean);
      }

      return [];
    } catch (error) {
      console.error('❌ Error fetching extensions:', error);
      return [];
    }
  }

  /**
   * Get sync statistics
   * @returns {Promise<Object>}
   */
  async getSyncStats() {
    try {
      const { data: totalRecords, error: totalError } = await supabase
        .from('call_logs')
        .select('id', { count: 'exact' });

      if (totalError) throw totalError;

      const { data: onecomRecords, error: onecomError } = await supabase
        .from('call_logs')
        .select('id', { count: 'exact' })
        .not('onecom_uniqueid', 'is', null);

      if (onecomError) throw onecomError;

      const { data: recentRecords, error: recentError } = await supabase
        .from('call_logs')
        .select('id', { count: 'exact' })
        .gte('cdate', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      if (recentError) throw recentError;

      return {
        total: totalRecords?.length || 0,
        fromOneCom: onecomRecords?.length || 0,
        last24Hours: recentRecords?.length || 0
      };
    } catch (error) {
      console.error('❌ Error getting sync stats:', error);
      return {
        total: 0,
        fromOneCom: 0,
        last24Hours: 0
      };
    }
  }

  /**
   * Process a single call log from webhook
   * @param {Object} webhookData - Call log data from OneCom webhook
   * @returns {Promise<Object>}
   */
  async processWebhookCallLog(webhookData) {
    try {
      console.log('🔔 Processing webhook call log:', webhookData);

      // Validate required fields
      if (!webhookData.uniqueid && !webhookData.call_id) {
        return {
          success: false,
          error: 'uniqueid or call_id is required'
        };
      }

      // Check if record already exists
      const uniqueId = webhookData.uniqueid || webhookData.call_id;
      const { data: existingRecord } = await supabase
        .from('call_logs')
        .select('id')
        .eq('onecom_uniqueid', uniqueId)
        .single();

      if (existingRecord) {
        console.log(`⏭️ Webhook: Skipping existing record: ${uniqueId}`);
        return {
          success: true,
          skipped: true,
          message: 'Call log already exists'
        };
      }

      // Map webhook data to database schema
      // The webhook data should match the structure from CSV parsing
      const dbRecord = await this.mapOneComToDatabase(webhookData);
      
      // Insert the record
      const { error } = await supabase
        .from('call_logs')
        .insert([dbRecord]);

      if (error) {
        console.error(`❌ Webhook: Error inserting record ${uniqueId}:`, error);
        return {
          success: false,
          error: error.message
        };
      }

      console.log(`✅ Webhook: Successfully saved call log: ${uniqueId}`);
      return {
        success: true,
        message: 'Call log saved successfully',
        uniqueid: uniqueId
      };

    } catch (error) {
      console.error('❌ Error processing webhook call log:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Process multiple call logs from webhook (batch processing)
   * @param {Array} webhookDataArray - Array of call log data from OneCom webhook
   * @returns {Promise<Object>}
   */
  async processWebhookCallLogs(webhookDataArray) {
    try {
      if (!Array.isArray(webhookDataArray)) {
        return {
          success: false,
          error: 'Expected array of call logs'
        };
      }

      console.log(`🔔 Processing ${webhookDataArray.length} call logs from webhook`);

      let synced = 0;
      let skipped = 0;
      const errors = [];

      for (const webhookData of webhookDataArray) {
        const result = await this.processWebhookCallLog(webhookData);
        
        if (result.success) {
          if (result.skipped) {
            skipped++;
          } else {
            synced++;
          }
        } else {
          errors.push({
            uniqueid: webhookData.uniqueid || webhookData.call_id || 'unknown',
            error: result.error
          });
        }
      }

      return {
        success: true,
        message: `Processed ${webhookDataArray.length} call logs: ${synced} synced, ${skipped} skipped, ${errors.length} errors`,
        synced,
        skipped,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error('❌ Error processing webhook call logs:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      };
    }
  }
}

module.exports = OneComSyncService;
