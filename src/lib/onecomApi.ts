interface OneComConfig {
  apiKey: string;
  tenant: string;
  baseUrl?: string;
}

interface CallLogRecord {
  uniqueid: string;
  ID: number;
  te_id: number;
  realsrc: string;
  lastdst: string;
  start: string;
  duration: number;
  answer: string;
  direction: string;
  disposition: string;
  calleridnum?: string;
  incomingdid?: string;
  recording_url?: string;
}

interface OneComApiResponse {
  success: boolean;
  data?: CallLogRecord[];
  error?: string;
  message?: string;
}

class OneComApiService {
  private config: OneComConfig;
  private baseUrl: string;

  constructor(config: OneComConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://pbx6webserver.1com.co.il/pbx/proxyapi.php';
  }

  /**
   * Fetch call logs from 1com using their ProxyAPI
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @param extensions - Comma-separated list of extensions (optional)
   * @returns Promise<OneComApiResponse>
   */
  async fetchCallLogs(
    startDate: string,
    endDate: string,
    extensions?: string
  ): Promise<OneComApiResponse> {
    try {
      const params = new URLSearchParams({
        key: this.config.apiKey,
        reqtype: 'INFO',
        info: 'CDRS',
        tenant: this.config.tenant,
        start: startDate,
        end: endDate,
        format: 'csv'
      });

      // Add extensions filter if provided
      if (extensions) {
        params.append('phone', extensions);
      }

      const url = `${this.baseUrl}?${params.toString()}`;
      console.log('🔗 Fetching 1com call logs:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/csv, application/json',
          'User-Agent': 'RMQ-CRM/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/json')) {
        // Handle JSON response (error case)
        const jsonData = await response.json();
        return {
          success: false,
          error: jsonData.error || 'Unknown error from 1com API',
          message: jsonData.message
        };
      } else {
        // Handle CSV response (success case)
        const csvData = await response.text();
        const parsedData = this.parseCsvResponse(csvData);
        
        return {
          success: true,
          data: parsedData
        };
      }
    } catch (error) {
      console.error('❌ Error fetching call logs from 1com:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Parse CSV response from 1com API
   * @param csvData - Raw CSV string
   * @returns CallLogRecord[]
   */
  private parseCsvResponse(csvData: string): CallLogRecord[] {
    try {
      const lines = csvData.trim().split('\n');
      if (lines.length < 2) {
        return [];
      }

      // Skip header line and parse data
      const dataLines = lines.slice(1);
      const records: CallLogRecord[] = [];

      for (const line of dataLines) {
        if (line.trim()) {
          const fields = this.parseCsvLine(line);
          if (fields.length >= 10) {
            records.push({
              uniqueid: fields[0] || '',
              ID: parseInt(fields[1]) || 0,
              te_id: parseInt(fields[2]) || 0,
              realsrc: fields[3] || '',
              lastdst: fields[4] || '',
              start: fields[5] || '',
              duration: parseInt(fields[6]) || 0,
              answer: fields[7] || '',
              direction: fields[8] || '',
              disposition: fields[9] || '',
              calleridnum: fields[10] || '',
              incomingdid: fields[11] || '',
              recording_url: fields[12] || ''
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
   * @param line - CSV line string
   * @returns string[]
   */
  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }

    // Add the last field
    fields.push(current.trim());

    return fields;
  }

  /**
   * Get recording URL for a specific call
   * @param callId - Unique call ID
   * @returns Promise<string | null>
   */
  async getRecordingUrl(callId: string): Promise<string | null> {
    try {
      const params = new URLSearchParams({
        key: this.config.apiKey,
        reqtype: 'INFO',
        info: 'recording',
        id: callId,
        tenant: this.config.tenant
      });

      const url = `${this.baseUrl}?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain',
          'User-Agent': 'RMQ-CRM/1.0'
        }
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.text();
      
      // 1com returns recording URLs directly as text or in JSON format
      if (data.startsWith('http')) {
        return data;
      }

      try {
        const jsonData = JSON.parse(data);
        return jsonData.url || jsonData.recording_url || null;
      } catch {
        return null;
      }
    } catch (error) {
      console.error('❌ Error fetching recording URL:', error);
      return null;
    }
  }

  /**
   * Test API connection and authentication
   * @returns Promise<boolean>
   */
  async testConnection(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        key: this.config.apiKey,
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
   * Get available extensions for the tenant
   * @returns Promise<string[]>
   */
  async getExtensions(): Promise<string[]> {
    try {
      const params = new URLSearchParams({
        key: this.config.apiKey,
        reqtype: 'MANAGEDB',
        object: 'extension',
        action: 'list',
        tenant: this.config.tenant
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
        return data.map((ext: any) => ext.ex_number || ext.number || ext.id).filter(Boolean);
      }

      return [];
    } catch (error) {
      console.error('❌ Error fetching extensions:', error);
      return [];
    }
  }
}

// Factory function to create OneCom API service
export function createOneComApi(config: OneComConfig): OneComApiService {
  return new OneComApiService(config);
}

// Default configuration (to be moved to environment variables)
export const defaultOneComConfig: OneComConfig = {
  apiKey: process.env.VITE_ONECOM_API_KEY || '',
  tenant: process.env.VITE_ONECOM_TENANT || '',
  baseUrl: process.env.VITE_ONECOM_BASE_URL || 'https://pbx6webserver.1com.co.il/pbx/proxyapi.php'
};

export type { OneComConfig, CallLogRecord, OneComApiResponse };
