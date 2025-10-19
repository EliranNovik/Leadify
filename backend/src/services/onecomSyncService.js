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

      // For now, let's try without date filtering to see if we can get data
      // TODO: Fix date format issue - API returns data without dates but empty with dates
      console.log('🔍 DEBUG: Temporarily skipping date filtering to test data availability');
      console.log('🔍 DEBUG: Original dates would be:', { start: startDate, end: endDate });

      const params = new URLSearchParams({
        key: this.apiKey,
        reqtype: 'INFO',
        info: 'cdrs',
        tenant: this.tenant,
        format: 'csv'
      });

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

    // Map employee_id from cleaned source extension and incoming DID
    const employeeId = await this.mapExtensionToEmployeeId(cleanSourceField, cleanIncomingDidField);
    
    // Map lead_id from destination number
    const leadId = await this.mapDestinationToLeadId(cleanDestinationField);

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
      // Map lead_id from destination number
      lead_id: leadId,
      // Store original 1com data for reference
      onecom_uniqueid: onecomRecord.uniqueid,
      onecom_te_id: onecomRecord.call_id?.toString() || '', // Convert to string to avoid integer overflow
      onecom_raw_data: JSON.stringify(onecomRecord)
    };
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

      // Comprehensive matching logic: 3 digits = extension, 4+ digits = phone number
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
          
          // Clean the search term (remove formatting)
          const cleanSearch = searchTerm.replace(/[^\d]/g, '');
          console.log(`    Cleaned search: "${cleanSearch}" (length: ${cleanSearch.length})`);
          
          // Determine if this is an extension (3 digits) or phone number (4+ digits)
          const isExtension = cleanSearch.length === 3;
          console.log(`    Type: ${isExtension ? 'EXTENSION (3 digits)' : 'PHONE NUMBER (4+ digits)'}`);
          
          for (const field of employeeFields) {
            const cleanField = field.value.replace(/[^\d]/g, '');
            console.log(`    Testing ${field.type}: "${field.value}" -> cleaned: "${cleanField}" (length: ${cleanField.length})`);
            
            if (isExtension) {
              // Extension matching: 3 digits, exact match with ANY field that has 3 digits
              if (cleanField.length === 3 && cleanSearch === cleanField) {
                console.log(`      ✅ EXTENSION EXACT MATCH: "${searchTerm}" matches "${field.value}"`);
                console.log(`✅ Extension exact match: ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                return employee.id;
              } else if (cleanField.length === 3) {
                console.log(`      ❌ Extension no match: "${cleanSearch}" !== "${cleanField}"`);
              } else {
                console.log(`      ⏭️ Skipping ${field.type} (not 3 digits: length ${cleanField.length})`);
              }
            } else {
              // Phone number matching: 4+ digits, match last 4 digits with ANY field that has 4+ digits
              if (cleanField.length >= 4) {
                const searchLast4 = cleanSearch.slice(-4);
                const fieldLast4 = cleanField.slice(-4);
                console.log(`      Comparing last 4: "${searchLast4}" vs "${fieldLast4}"`);
                
                if (searchLast4 === fieldLast4) {
                  console.log(`      ✅ PHONE NUMBER MATCH: "${searchTerm}" matches "${field.value}"`);
                  console.log(`✅ Phone number match (last 4 digits): ${searchTerm} -> ${employee.display_name} (ID: ${employee.id}) via ${field.type}: ${field.value}`);
                  return employee.id;
                } else {
                  console.log(`      ❌ Phone number no match: "${searchLast4}" !== "${fieldLast4}"`);
                }
              } else {
                console.log(`      ⏭️ Skipping ${field.type} (too short: length ${cleanField.length})`);
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
   * Map destination phone number to lead_id
   * @param {string} destination - Destination phone number from 1com
   * @returns {Promise<number|null>}
   */
  async mapDestinationToLeadId(destination) {
    if (!destination || destination === '---') {
      return null;
    }

    try {
      // Clean the destination number (remove formatting)
      const cleanDestination = destination.replace(/[^\d]/g, '');
      console.log(`🔍 Mapping destination "${destination}" -> cleaned: "${cleanDestination}"`);

      if (cleanDestination.length < 9) {
        console.log(`❌ Destination too short for phone matching (need 9+ digits): ${cleanDestination}`);
        return null;
      }

      // Get the last 9 digits for matching (stricter matching)
      const last9Digits = cleanDestination.slice(-9);
      console.log(`  Last 9 digits: ${last9Digits}`);

      // Find contacts with matching phone numbers
      const { data: contacts, error: contactsError } = await supabase
        .from('leads_contact')
        .select('id, name, mobile, phone, additional_phones')
        .or(
          `mobile.like.%${last9Digits},` +
          `phone.like.%${last9Digits},` +
          `additional_phones.like.%${last9Digits}`
        );

      if (contactsError) {
        console.error('Error fetching contacts:', contactsError);
        return null;
      }

      if (!contacts || contacts.length === 0) {
        console.log(`❌ No contacts found with phone numbers ending in ${last9Digits}`);
        return null;
      }

      console.log(`📞 Found ${contacts.length} potential contacts`);

      // For each contact, check if any phone number matches
      for (const contact of contacts) {
        console.log(`  👤 Checking contact: ${contact.name} (ID: ${contact.id})`);
        
        const phoneNumbers = [
          contact.mobile,
          contact.phone,
          contact.additional_phones
        ].filter(phone => phone && phone !== '' && phone !== '\\N');

        for (const phone of phoneNumbers) {
          if (phone) {
            const cleanPhone = phone.replace(/[^\d]/g, '');
            const phoneLast9 = cleanPhone.slice(-9);
            
            console.log(`    Phone: "${phone}" -> cleaned: "${cleanPhone}" -> last 9: "${phoneLast9}"`);
            
            if (phoneLast9 === last9Digits) {
              console.log(`    ✅ Phone match found!`);
              
              // Find the lead for this contact
              const { data: leadContacts, error: leadError } = await supabase
                .from('lead_leadcontact')
                .select('lead_id')
                .eq('contact_id', contact.id)
                .limit(1);

              if (leadError) {
                console.error('Error fetching lead for contact:', leadError);
                continue;
              }

              if (leadContacts && leadContacts.length > 0) {
                const leadId = leadContacts[0].lead_id;
                console.log(`✅ Lead mapping: destination "${destination}" -> contact "${contact.name}" -> lead_id ${leadId}`);
                return leadId;
              } else {
                console.log(`    ❌ No lead found for contact ${contact.id}`);
              }
            }
          }
        }
      }

      console.log(`❌ No lead mapping found for destination "${destination}"`);
      return null;
    } catch (error) {
      console.error(`Error mapping destination "${destination}":`, error);
      return null;
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

      const onecomRecords = onecomResponse.data;
      if (!onecomRecords || onecomRecords.length === 0) {
        console.log(`📊 DEBUG: No records found, returning success with 0 synced`);
        return {
          success: true,
          message: 'No call logs found for the specified date range',
          synced: 0,
          skipped: 0
        };
      }

      console.log(`📊 DEBUG: Found ${onecomRecords.length} call logs from 1com`);

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
}

module.exports = OneComSyncService;
