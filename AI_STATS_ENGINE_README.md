# AI Stats Engine for Leadify CRM

## Overview

The AI Stats Engine is a general-purpose query system that allows your AI assistant to dynamically generate and execute database queries based on natural language questions. Instead of writing hundreds of separate functions, you now have one smart system that can handle various statistical queries.

## How It Works

### 1. Natural Language Processing

Users can ask questions in natural language:

- "How many contracts were signed yesterday?"
- "What is the average processing time for Austrian cases last month?"
- "List all leads created by Olga in June."
- "How many new clients entered this week?"

### 2. Dynamic Query Generation

The AI assistant interprets these questions and generates structured query parameters for the `query_executor` function.

### 3. Secure Execution

The system validates all inputs against a whitelist of allowed tables, columns, and operations before executing any queries.

## Supported Operations

### Tables

- `leads` - All lead/client data
- `meetings` - Meeting information
- `interactions` - Client interaction history

### Operations

- `count` - Count records
- `avg` - Calculate average
- `sum` - Calculate sum
- `min` - Find minimum value
- `max` - Find maximum value
- `distinct` - Count distinct values
- `select` - Retrieve specific records

### Filter Operators

- `=` - Equal
- `!=` - Not equal
- `<` - Less than
- `<=` - Less than or equal
- `>` - Greater than
- `>=` - Greater than or equal
- `like` - Pattern matching

## Example Queries

### 1. Count Contracts Signed Yesterday

```json
{
  "table": "leads",
  "operation": "count",
  "filters": [
    {
      "column": "stage",
      "operator": "=",
      "value": "client signed agreement"
    },
    {
      "column": "date_signed",
      "operator": "=",
      "value": "2024-01-15"
    }
  ]
}
```

### 2. Average Proposal Value This Month

```json
{
  "table": "leads",
  "operation": "avg",
  "column": "proposal_total",
  "filters": [
    {
      "column": "created_at",
      "operator": ">=",
      "value": "2024-01-01"
    }
  ]
}
```

### 3. Leads Created by Specific Expert

```json
{
  "table": "leads",
  "operation": "select",
  "column": "name",
  "filters": [
    {
      "column": "expert",
      "operator": "=",
      "value": "John Smith"
    },
    {
      "column": "created_at",
      "operator": ">=",
      "value": "2024-01-01"
    }
  ],
  "limit": 10
}
```

## Security Features

### 1. Table Whitelist

Only predefined tables are allowed:

- `leads`
- `meetings`
- `interactions`

### 2. Column Whitelist

Each table has a specific set of allowed columns to prevent unauthorized access.

### 3. Operation Validation

Only safe operations are permitted (no INSERT, UPDATE, DELETE).

### 4. SQL Injection Protection

All inputs are properly escaped and validated before query execution.

## Setup Instructions

### 1. Database Setup

Run the SQL function in your Supabase database:

```sql
-- Execute the contents of supabase_functions.sql
-- This creates the execute_aggregate_query RPC function
```

### 2. Frontend Integration

The `query_executor` function is already integrated into your `AIChatWindow.tsx` component.

### 3. AI Assistant Configuration

Your AI assistant needs to be configured with the `query_executor` function schema. Add this to your AI assistant's function definitions:

```json
{
  "name": "query_executor",
  "description": "Run dynamic, secure database queries on CRM data",
  "parameters": {
    "type": "object",
    "properties": {
      "table": {
        "type": "string",
        "description": "Allowed values: 'leads', 'meetings', 'interactions'"
      },
      "operation": {
        "type": "string",
        "enum": ["count", "avg", "sum", "min", "max", "distinct", "select"],
        "description": "The type of data query to run"
      },
      "column": {
        "type": "string",
        "description": "Column name to perform operation on (required for avg, sum, etc.)"
      },
      "filters": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "column": { "type": "string" },
            "operator": {
              "type": "string",
              "enum": ["=", "!=", "<", "<=", ">", ">=", "like"]
            },
            "value": { "type": "string" }
          },
          "required": ["column", "operator", "value"]
        },
        "description": "Filter conditions for rows"
      },
      "group_by": {
        "type": "string",
        "description": "Column to group results by (optional)"
      },
      "limit": {
        "type": "integer",
        "description": "Max number of rows to return (for select operations)"
      },
      "offset": {
        "type": "integer",
        "description": "Row offset (for paginated select operations)"
      }
    },
    "required": ["table", "operation"]
  }
}
```

## Usage Examples

### Natural Language Questions → AI Generated Queries

1. **"How many new leads were created this week?"**

   - AI generates: Count leads where created_at >= start_of_week

2. **"What's the average proposal value for German citizenship cases?"**

   - AI generates: Average proposal_total where topic = "German Citizenship"

3. **"Show me all clients who signed agreements in December"**

   - AI generates: Select leads where stage = "client signed agreement" AND date_signed >= "2024-12-01"

4. **"How many meetings were scheduled last month?"**
   - AI generates: Count meetings where meeting_date >= "2024-12-01"

## Benefits

1. **Scalability**: No need to write individual functions for each query type
2. **Flexibility**: Handles any combination of filters and operations
3. **Security**: Comprehensive input validation and SQL injection protection
4. **User-Friendly**: Natural language interface
5. **Maintainable**: Single system to maintain instead of hundreds of functions

## Troubleshooting

### Common Issues

1. **"Table not allowed" error**

   - Check that the table name is in the allowedTables whitelist

2. **"Column not allowed" error**

   - Verify the column exists in the allowed columns for that table

3. **"Operation not allowed" error**

   - Ensure the operation is one of: count, avg, sum, min, max, distinct, select

4. **Query returns no results**
   - Check filter values and date formats
   - Verify data exists in the specified date ranges

### Debugging

The system includes error handling that provides detailed error messages. Check the browser console and network tab for specific error details.

## Future Enhancements

1. **Date Range Helpers**: Add support for relative dates like "last week", "this month"
2. **Chart Generation**: Automatically generate charts for numerical data
3. **Export Functionality**: Allow exporting query results to CSV/Excel
4. **Saved Queries**: Let users save frequently used queries
5. **Real-time Updates**: Subscribe to data changes for live dashboards
