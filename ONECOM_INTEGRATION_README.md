# 1com API Integration

This document describes how to integrate with the 1com PBX system to fetch call logs and recordings.

## Overview

The 1com integration allows you to:

- Fetch call logs from 1com PBX system
- Sync call data to your database
- Access call recordings
- Get real-time call statistics

## Setup

### 1. Get 1com API Credentials

1. Log into your 1com PBX admin panel
2. Go to **Configuration/Settings**
3. Generate an API key with Read/Write access
4. Note your tenant code (e.g., "DEMO", "decker", etc.)

### 2. Configure Environment Variables

Add these to your backend `.env` file:

```env
# 1com API Configuration
ONECOM_API_KEY=your_api_key_here
ONECOM_TENANT=your_tenant_code_here
ONECOM_BASE_URL=https://pbx6webserver.1com.co.il/pbx/proxyapi.php
```

### 3. Database Setup

Run the SQL script to add 1com columns to your call_logs table:

```bash
psql -d your_database -f sql/add_onecom_columns_to_call_logs.sql
```

### 4. Test Connection

Test your 1com connection:

```bash
curl -X GET "http://localhost:3001/api/onecom/test"
```

## API Endpoints

### Test Connection

```http
GET /api/onecom/test
```

### Sync Call Logs

```http
POST /api/onecom/sync
Content-Type: application/json

{
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "extensions": "103,104,105" // optional
}
```

### Quick Sync Today

```http
POST /api/onecom/sync/today
```

### Quick Sync Last Week

```http
POST /api/onecom/sync/last-week
```

### Get Sync Statistics

```http
GET /api/onecom/stats
```

### Get Available Extensions

```http
GET /api/onecom/extensions
```

## Frontend Usage

### Using the Calls Ledger Page

1. Navigate to the Calls Ledger page
2. Set your date range
3. Click "Sync 1com" to sync call logs for the selected range
4. Click "Sync Today" for a quick sync of today's calls

### Using the API Client

```typescript
import { onecomSyncApi } from "../lib/onecomSyncApi";

// Test connection
const connectionTest = await onecomSyncApi.testConnection();

// Sync call logs
const syncResult = await onecomSyncApi.syncCallLogs({
  startDate: "2024-01-01",
  endDate: "2024-01-31",
});

// Quick sync today
const todaySync = await onecomSyncApi.syncToday();
```

## Data Mapping

### 1com to Database Mapping

| 1com Field    | Database Column   | Description              |
| ------------- | ----------------- | ------------------------ |
| `uniqueid`    | `onecom_uniqueid` | Unique call identifier   |
| `ID`          | `call_id`         | Call ID                  |
| `te_id`       | `onecom_te_id`    | Tenant extension ID      |
| `realsrc`     | `source`          | Source number            |
| `lastdst`     | `destination`     | Destination number       |
| `start`       | `cdate`           | Call start time          |
| `duration`    | `duration`        | Call duration in seconds |
| `answer`      | `status`          | Call status              |
| `direction`   | `direction`       | Call direction           |
| `disposition` | `action`          | Call disposition         |

## Features

### Automatic Duplicate Prevention

- Uses `onecom_uniqueid` to prevent duplicate entries
- Skips existing records during sync

### Error Handling

- Comprehensive error logging
- Graceful handling of API failures
- Retry logic for failed requests

### Progress Tracking

- Real-time sync progress
- Detailed sync statistics
- Error reporting

### Recording Access

- Automatic recording URL extraction
- Proxy endpoint for CORS-free access
- Support for archived recordings

## Troubleshooting

### Common Issues

1. **API Key Invalid**

   - Verify your API key in 1com admin panel
   - Ensure Read/Write permissions are enabled

2. **Tenant Code Error**

   - Check your tenant code is correct
   - Verify tenant has proper permissions

3. **Date Range Too Large**

   - API limits date ranges to 30 days
   - Break large ranges into smaller chunks

4. **Recording Not Found**
   - Old recordings (2024) may be archived
   - Check recording permissions

### Debug Mode

Enable debug logging by setting:

```env
DEBUG=onecom:*
```

### Manual Testing

Test individual API calls:

```bash
# Test connection
curl "https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=YOUR_KEY&reqtype=HELP"

# Get call logs
curl "https://pbx6webserver.1com.co.il/pbx/proxyapi.php?key=YOUR_KEY&reqtype=INFO&info=CDRS&tenant=YOUR_TENANT&start=2024-01-01&end=2024-01-01&format=csv"
```

## Security Considerations

1. **API Key Protection**

   - Store API keys in environment variables
   - Never commit keys to version control
   - Use different keys for different environments

2. **Rate Limiting**

   - 1com API has rate limits
   - Implement appropriate delays between requests
   - Monitor API usage

3. **Data Privacy**
   - Call logs may contain sensitive information
   - Implement proper access controls
   - Consider data retention policies

## Performance Optimization

1. **Batch Processing**

   - Process calls in batches
   - Use database transactions
   - Implement connection pooling

2. **Caching**

   - Cache extension lists
   - Cache sync statistics
   - Implement smart refresh strategies

3. **Indexing**
   - Index `onecom_uniqueid` for fast lookups
   - Index date ranges for efficient queries
   - Monitor query performance

## Monitoring

### Sync Statistics

```sql
SELECT * FROM get_onecom_sync_stats();
```

### Recent Sync Activity

```sql
SELECT
    DATE(cdate) as sync_date,
    COUNT(*) as calls_synced
FROM call_logs
WHERE onecom_uniqueid IS NOT NULL
    AND cdate >= NOW() - INTERVAL '7 days'
GROUP BY DATE(cdate)
ORDER BY sync_date DESC;
```

### Error Tracking

```sql
SELECT
    onecom_uniqueid,
    onecom_raw_data->>'error' as error_message
FROM call_logs
WHERE onecom_raw_data->>'error' IS NOT NULL;
```

## Future Enhancements

1. **Automatic Sync**

   - Scheduled sync jobs
   - Webhook integration
   - Real-time updates

2. **Advanced Filtering**

   - Extension-specific sync
   - Status-based filtering
   - Custom date patterns

3. **Analytics**

   - Call volume trends
   - Performance metrics
   - Usage statistics

4. **Integration Features**
   - Export to other systems
   - API webhooks
   - Custom reporting
