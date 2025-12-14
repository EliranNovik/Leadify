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
      const params = new URLSearchParams({
        key: this.apiKey,
        reqtype: 'INFO',
        info: 'cdrs',
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

      if (extensions) {
        params.append('phone', extensions);
      }

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
   * Parse CSV response from 1com API
   * @param {string} csvData - Raw CSV string
   * @returns {Array}
   */
  parseCsvResponse(csvData) {
    try {
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        return [];
      }

      const dataLines = lines.slice(1);
      const records = [];

      for (const line of dataLines) {
        if (line.trim()) {
          const fields = this.parseCsvLine(line);
          if (fields.length >= 15) { // Need at least uniqueid field
            records.push({
              accountcode: fields[0] || '',
              call_id: fields[1] || '',
              start: fields[2] || '',
              answer: fields[3] || '',
              end: fields[4] || '',
              clid: fields[5] || '',
              realsrc: fields[6] || '',
              firstdst: fields[7] || '',
              duration: parseInt(fields[8]) || 0,
              billsec: parseInt(fields[9]) || 0,
              disposition: fields[10] || '',
              cc_cost: fields[11] || '',
              dcontext: fields[12] || '',
              dstchannel: fields[13] || '',
              userfield: fields[14] || '',
              uniqueid: fields[15] || '',
              prevuniqueid: fields[16] || '',
              lastdst: fields[17] || '',
              wherelanded: fields[18] || '',
              src: fields[19] || '',
              dst: fields[20] || '',
              lastapp: fields[21] || '',
              srcCallID: fields[22] || '',
              linkedid: fields[23] || '',
              peeraccount: fields[24] || '',
              originateid: fields[25] || '',
              cc_country: fields[26] || '',
              cc_network: fields[27] || '',
              pincode: fields[28] || '',
              cc_buy: fields[29] || ''
            });
          }
        }
      }

      console.log(`✅ Parsed ${records.length} call log records from 1com`);
      return records;
    } catch (error) {
      console.error('❌ Error parsing CSV response:', error);
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
  async mapOneComToDatabase(onecomRecord) {
    // Parse the start date/time
    const startDateTime = new Date(onecomRecord.start);
    const date = startDateTime.toISOString().split('T')[0];
    const time = startDateTime.toTimeString().substring(0, 8);

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

    // Map employee_id from cleaned source extension/phone and incoming DID
    // This handles both cases:
    // 1. Source field contains extension (e.g., "214") - matches by extension
    // 2. Source field contains phone number (e.g., "0507825939") - matches by last 5 digits
    const employeeId = await this.mapExtensionToEmployeeId(cleanSourceField, cleanIncomingDidField);
    
    // Map lead_id from destination number (call_logs table only supports legacy lead_id, not client_id)
    const leadMapping = await this.mapDestinationToLeadId(cleanDestinationField);
    const leadId = leadMapping.leadId; // Only use leadId for legacy leads (call_logs table structure)

    // Try to get recording URL if available
    let recordingUrl = '';
    if (onecomRecord.uniqueid) {
      try {
        // According to 1com docs, we can get recording with: 
        // https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=KEY&reqtype=INFO&info=recording&id=UNIQUEID&tenant=TENANT
        const recordingApiUrl = `${this.baseUrl}/pbx/proxyapi.php?key=${this.apiKey}&reqtype=INFO&info=recording&id=${onecomRecord.uniqueid}&tenant=${this.tenant}`;
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
      const recordingUrl = `${this.baseUrl}/pbx/proxyapi.php?key=${this.apiKey}&reqtype=INFO&info=recording&id=${uniqueId}&tenant=${this.tenant}`;
      
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
   * Cross-matches ALL employee phone/mobile/extension fields against BOTH source and incoming DID
   * @param {string} source - Extension or phone number from 1com
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
      console.log(`🔍 Starting matching process with ${allEmployees.length} employees`);
      
      for (const employee of allEmployees) {
        console.log(`\n👤 Checking employee: ${employee.display_name} (ID: ${employee.id})`);
        
        const employeeFields = [
          { value: employee.phone_ext, type: 'phone_ext' },
          { value: employee.phone, type: 'phone' },
          { value: employee.mobile, type: 'mobile' },
          { value: employee.mobile_ext, type: 'mobile_ext' }
        ].filter(field => field.value && field.value !== '' && field.value !== '\\N');

        console.log(`  Available fields: ${employeeFields.map(f => `${f.type}="${f.value}"`).join(', ')}`);

        for (const searchTerm of searchTerms) {
          console.log(`\n  🔍 Searching for: "${searchTerm}"`);
          
          // Normalize and clean the search term
          const normalizedSearch = this.normalizePhoneNumber(searchTerm);
          console.log(`    Normalized search: "${normalizedSearch}" (length: ${normalizedSearch.length})`);
          
          // Determine if this is an extension (2-4 digits) or phone number (5+ digits)
          const isExtension = normalizedSearch.length >= 2 && normalizedSearch.length <= 4;
          console.log(`    Type: ${isExtension ? `EXTENSION (${normalizedSearch.length} digits)` : `PHONE NUMBER (${normalizedSearch.length} digits)`}`);
          
          for (const field of employeeFields) {
            const normalizedField = this.normalizePhoneNumber(field.value);
            console.log(`    Testing ${field.type}: "${field.value}" -> normalized: "${normalizedField}" (length: ${normalizedField.length})`);
            
            if (isExtension) {
              // Extension matching: 2-4 digits, exact match or partial match
              // Try exact match first
              if (normalizedField === normalizedSearch) {
                console.log(`      ✅ EXTENSION EXACT MATCH: "${searchTerm}" matches "${field.value}"`);
                console.log(`✅ Extension exact match: ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
              // Try partial match: check if search term is contained in field or vice versa
              if (normalizedField.length >= normalizedSearch.length && normalizedField.slice(-normalizedSearch.length) === normalizedSearch) {
                console.log(`      ✅ EXTENSION PARTIAL MATCH (ends with): "${searchTerm}" matches end of "${field.value}"`);
                console.log(`✅ Extension partial match: ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
              if (normalizedSearch.length >= normalizedField.length && normalizedSearch.slice(-normalizedField.length) === normalizedField) {
                console.log(`      ✅ EXTENSION PARTIAL MATCH (contained): "${searchTerm}" contains "${field.value}"`);
                console.log(`✅ Extension partial match: ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              }
            } else {
              // Phone number matching: 5+ digits, match last 5 digits (less restrictive)
              if (normalizedField.length >= 5 && normalizedSearch.length >= 5) {
                const searchLast5 = normalizedSearch.slice(-5);
                const fieldLast5 = normalizedField.slice(-5);
                console.log(`      Comparing last 5: "${searchLast5}" vs "${fieldLast5}"`);
                
                if (searchLast5 === fieldLast5) {
                  console.log(`      ✅ PHONE NUMBER MATCH (last 5 digits): "${searchTerm}" matches "${field.value}"`);
                  console.log(`✅ Phone number match (last 5 digits): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                  return employee.id;
                } else {
                  console.log(`      ❌ Phone number no match: "${searchLast5}" !== "${fieldLast5}"`);
                }
              } else if (normalizedField.length >= 4 && normalizedSearch.length >= 4) {
                // Fallback to last 4 digits if one is shorter than 5
                const searchLast4 = normalizedSearch.slice(-4);
                const fieldLast4 = normalizedField.slice(-4);
                console.log(`      Comparing last 4 (fallback): "${searchLast4}" vs "${fieldLast4}"`);
                
                if (searchLast4 === fieldLast4) {
                  console.log(`      ✅ PHONE NUMBER MATCH (last 4 digits fallback): "${searchTerm}" matches "${field.value}"`);
                  console.log(`✅ Phone number match (last 4 digits fallback): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                  return employee.id;
                }
              } else {
                console.log(`      ⏭️ Skipping ${field.type} (too short: search=${normalizedSearch.length}, field=${normalizedField.length})`);
              }
            }
          }
        }
      }

      console.log(`❌ No automatic mapping found for ${source} (searched ${searchTerms.length} terms across ${allEmployees.length} employees)`);
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
   * Map destination phone number to lead_id (using WhatsApp-style comprehensive matching)
   * Checks both main lead phone numbers and contacts for new and legacy leads
   * @param {string} destination - Destination phone number from 1com
   * @returns {Promise<{leadId: number|null, clientId: string|null}>}
   */
  async mapDestinationToLeadId(destination) {
    if (!destination || destination === '---') {
      return { leadId: null, clientId: null };
    }

    try {
      // Normalize the phone number and create variations (same as WhatsApp implementation)
      const incomingNormalized = this.normalizePhone(destination);
      const incomingVariations = [
        incomingNormalized,
        incomingNormalized.replace(/^972/, ''), // Remove country code
        incomingNormalized.replace(/^00972/, ''), // Remove 00972 prefix
        incomingNormalized.replace(/^0/, ''), // Remove leading 0
        `972${incomingNormalized.replace(/^972/, '')}`, // Add country code
        `0${incomingNormalized.replace(/^0/, '')}`, // Add leading 0
        incomingNormalized.replace(/^972/, '0'), // Replace 972 with 0
        incomingNormalized.replace(/^0/, '972'), // Replace 0 with 972
      ].filter(Boolean);

      const normalizedSet = new Set(
        incomingVariations
          .map(v => this.normalizePhone(v))
          .filter(Boolean)
      );
      normalizedSet.add(incomingNormalized);

      const rawSearchValues = Array.from(new Set(
        incomingVariations
          .concat([destination])
          .filter(Boolean)
      ));

      console.log(`🔍 Mapping destination "${destination}" -> normalized: "${incomingNormalized}", variations: ${incomingVariations.length}`);

      if (incomingNormalized.length < 8) {
        console.log(`❌ Destination too short for phone matching (need 8+ digits): ${incomingNormalized}`);
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

      // STEP 1: Try exact matches in contacts using .in() queries (fastest)
      if (rawSearchValues.length > 0) {
        const { data: phoneMatches } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .in('phone', rawSearchValues);
        if (phoneMatches) addContacts(phoneMatches);

        const { data: mobileMatches } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .in('mobile', rawSearchValues);
        if (mobileMatches) addContacts(mobileMatches);
      }

      // Store direct lead matches for fallback if no contacts found
      let directNewLeadMatch = null;
      let directLegacyLeadMatch = null;

      // STEP 2: If no exact matches found, try partial matching using last 8 digits (same as WhatsApp)
      const last8Digits = incomingNormalized.length >= 8 ? incomingNormalized.slice(-8) : null;
      
      if (!contactCandidatesMap.size && last8Digits) {
        console.log(`📞 No exact contact matches, trying partial matching with last 8 digits: ${last8Digits}`);
        
        // Search in leads_contact table with last 8 digits (includes additional_phones)
        const { data: contactPartialMatches } = await supabase
          .from('leads_contact')
          .select(contactSelectColumns)
          .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`);
        if (contactPartialMatches) addContacts(contactPartialMatches);
        
        // Also search via lead_leadcontact junction table to find leads associated with matching contacts
        const { data: matchingContactsByLast8 } = await supabase
          .from('leads_contact')
          .select('id')
          .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`);
        
        if (matchingContactsByLast8 && matchingContactsByLast8.length > 0) {
          const matchingContactIds = matchingContactsByLast8.map(c => c.id);
          
          // Find all leads (new and legacy) linked to these contacts via lead_leadcontact
          const { data: linkedLeadsViaContacts } = await supabase
            .from('lead_leadcontact')
            .select('newlead_id, lead_id')
            .in('contact_id', matchingContactIds);
          
          if (linkedLeadsViaContacts && linkedLeadsViaContacts.length > 0) {
            // Get unique new lead IDs
            const newLeadIds = [...new Set(linkedLeadsViaContacts
              .filter(ll => ll.newlead_id)
              .map(ll => ll.newlead_id)
            )];
            
            // Get unique legacy lead IDs
            const legacyLeadIds = [...new Set(linkedLeadsViaContacts
              .filter(ll => ll.lead_id)
              .map(ll => ll.lead_id)
            )];
            
            // Fetch the actual new leads
            if (newLeadIds.length > 0) {
              const { data: newLeadsFromContacts } = await supabase
                .from('leads')
                .select('id, name, phone, mobile')
                .in('id', newLeadIds)
                .limit(1);
              
              if (newLeadsFromContacts && newLeadsFromContacts.length > 0 && !directNewLeadMatch) {
                directNewLeadMatch = newLeadsFromContacts[0];
              }
            }
            
            // Fetch the actual legacy leads
            if (legacyLeadIds.length > 0) {
              const { data: legacyLeadsFromContacts } = await supabase
                .from('leads_lead')
                .select('id, name, phone, mobile')
                .in('id', legacyLeadIds)
                .limit(1);
              
              if (legacyLeadsFromContacts && legacyLeadsFromContacts.length > 0 && !directLegacyLeadMatch) {
                directLegacyLeadMatch = legacyLeadsFromContacts[0];
              }
            }
          }
        }
        
        // Also search directly in leads table (new leads) for phone and mobile columns
        if (!directNewLeadMatch) {
          const { data: newLeadsMatches } = await supabase
            .from('leads')
            .select('id, name, phone, mobile')
            .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%`)
            .limit(1);
          
          if (newLeadsMatches && newLeadsMatches.length > 0) {
            directNewLeadMatch = newLeadsMatches[0];
          }
        }
        
        // Also search directly in leads_lead table (legacy leads) for phone and mobile columns
        if (!directLegacyLeadMatch) {
          const { data: legacyLeadsMatches } = await supabase
            .from('leads_lead')
            .select('id, name, phone, mobile, additional_phones')
            .or(`phone.ilike.%${last8Digits}%,mobile.ilike.%${last8Digits}%,additional_phones.ilike.%${last8Digits}%`)
            .limit(1);
          
          if (legacyLeadsMatches && legacyLeadsMatches.length > 0) {
            directLegacyLeadMatch = legacyLeadsMatches[0];
          }
        }
      }

      // STEP 3: Process contact candidates (same logic as WhatsApp)
      const candidates = Array.from(contactCandidatesMap.values());
      for (const contact of candidates) {
        const contactPhones = [
          contact.phone,
          contact.mobile,
          ...this.parseAdditionalPhones(contact.additional_phones || '')
        ].filter(Boolean);

        const contactNormalizedPhones = contactPhones
          .map(p => this.normalizePhone(p))
          .filter(Boolean);

        const hasMatch = contactNormalizedPhones.some(number => normalizedSet.has(number));
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

      // STEP 4: If no contacts found but we found leads directly, return the first matching lead
      if (!contactCandidatesMap.size) {
        if (directNewLeadMatch) {
          console.log(`✅ DIRECT NEW LEAD match: destination "${destination}" -> new lead "${directNewLeadMatch.name}" (ID: ${directNewLeadMatch.id})`);
          return { leadId: null, clientId: directNewLeadMatch.id };
        }
        
        if (directLegacyLeadMatch) {
          console.log(`✅ DIRECT LEGACY LEAD match: destination "${destination}" -> legacy lead "${directLegacyLeadMatch.name}" (ID: ${directLegacyLeadMatch.id})`);
          return { leadId: directLegacyLeadMatch.id, clientId: null };
        }
      }

      console.log(`❌ No lead mapping found for destination "${destination}"`);
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
   * @returns {Promise<Object>}
   */
  async syncCallLogs(startDate, endDate, extensions = null) {
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

      console.log(`📊 DEBUG: Found ${onecomRecords.length} call logs from 1com before date filtering`);

      // Filter records by date range (in case API doesn't filter properly or returns all records)
      if (startDate && endDate) {
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T23:59:59');
        
        onecomRecords = onecomRecords.filter(record => {
          if (!record.start) return false;
          
          try {
            // Parse the start date from the record (format: "2025-12-13 01:35:47")
            const recordDate = new Date(record.start.replace(' ', 'T'));
            
            // Check if record date is within range
            const isInRange = recordDate >= start && recordDate <= end;
            
            if (!isInRange) {
              console.log(`📅 Filtering out record ${record.uniqueid} - date ${record.start} is outside range ${startDate} to ${endDate}`);
            }
            
            return isInRange;
          } catch (error) {
            console.error(`❌ Error parsing date for record ${record.uniqueid}:`, error);
            return false;
          }
        });
        
        console.log(`📊 DEBUG: After date filtering: ${onecomRecords.length} call logs remain`);
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

      for (const onecomRecord of onecomRecords) {
        try {
          // Check if record already exists
          const existingRecord = await supabase
            .from('call_logs')
            .select('id')
            .eq('onecom_uniqueid', onecomRecord.uniqueid)
            .single();

          if (existingRecord.data) {
            console.log(`⏭️ Skipping existing record: ${onecomRecord.uniqueid}`);
            skipped++;
            continue;
          }

          // Map to database schema (async)
          const dbRecord = await this.mapOneComToDatabase(onecomRecord);
          
          const { error } = await supabase
            .from('call_logs')
            .insert([dbRecord]);

          if (error) {
            console.error(`❌ Error inserting record ${onecomRecord.uniqueid}:`, error);
            errors.push({
              uniqueid: onecomRecord.uniqueid,
              error: error.message
            });
          } else {
            console.log(`✅ Synced record: ${onecomRecord.uniqueid}`);
            synced++;
          }
        } catch (recordError) {
          console.error(`❌ Error processing record ${onecomRecord.uniqueid}:`, recordError);
          errors.push({
            uniqueid: onecomRecord.uniqueid,
            error: recordError.message
          });
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
