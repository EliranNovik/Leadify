interface SyncRequest {
  startDate: string;
  endDate: string;
  extensions?: string;
}

interface SyncResponse {
  success: boolean;
  message: string;
  data?: {
    synced: number;
    skipped: number;
    errors?: Array<{
      uniqueid: string;
      error: string;
    }>;
  };
  error?: string;
}

interface ConnectionTestResponse {
  success: boolean;
  message: string;
  connected: boolean;
}

interface SyncStatsResponse {
  success: boolean;
  data: {
    total: number;
    fromOneCom: number;
    last24Hours: number;
  };
}

interface ExtensionsResponse {
  success: boolean;
  data: string[];
}

class OneComSyncApi {
  private baseUrl: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
  }

  /**
   * Test 1com API connection
   */
  async testConnection(): Promise<ConnectionTestResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/test`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error testing 1com connection:', error);
      return {
        success: false,
        message: 'Connection test failed',
        connected: false
      };
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<SyncStatsResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/stats`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error getting sync stats:', error);
      return {
        success: false,
        data: {
          total: 0,
          fromOneCom: 0,
          last24Hours: 0
        }
      };
    }
  }

  /**
   * Get available extensions
   */
  async getExtensions(): Promise<ExtensionsResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/extensions`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error getting extensions:', error);
      return {
        success: false,
        data: []
      };
    }
  }

  /**
   * Sync call logs for a specific date range
   */
  async syncCallLogs(request: SyncRequest): Promise<SyncResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error syncing call logs:', error);
      return {
        success: false,
        message: 'Sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Quick sync for today
   */
  async syncToday(): Promise<SyncResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/sync/today`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error syncing today:', error);
      return {
        success: false,
        message: 'Today sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Quick sync for last week
   */
  async syncLastWeek(): Promise<SyncResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/onecom/sync/last-week`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('❌ Error syncing last week:', error);
      return {
        success: false,
        message: 'Last week sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sync call logs with progress tracking
   */
  async syncWithProgress(
    request: SyncRequest,
    onProgress?: (progress: { synced: number; skipped: number; total: number; errors: number }) => void
  ): Promise<SyncResponse> {
    try {
      // For now, we'll just call the regular sync and simulate progress
      // In a real implementation, you might want to use WebSockets or Server-Sent Events
      const result = await this.syncCallLogs(request);
      
      if (result.success && result.data && onProgress) {
        const { synced, skipped, errors } = result.data;
        onProgress({
          synced,
          skipped,
          total: synced + skipped + (errors?.length || 0),
          errors: errors?.length || 0
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Error in sync with progress:', error);
      return {
        success: false,
        message: 'Sync with progress failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const onecomSyncApi = new OneComSyncApi();
export type { SyncRequest, SyncResponse, ConnectionTestResponse, SyncStatsResponse, ExtensionsResponse };
