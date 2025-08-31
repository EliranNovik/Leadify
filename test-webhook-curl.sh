#!/bin/bash

echo "Testing webhook accessibility..."

WEBHOOK_URL="https://mtccyevuosqfrcaoztzt.supabase.co/functions/v1/graph-webhook"

echo "1. Testing GET request..."
curl -X GET "$WEBHOOK_URL" -v

echo -e "\n\n2. Testing OPTIONS request..."
curl -X OPTIONS "$WEBHOOK_URL" \
  -H "Origin: https://graph.microsoft.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v

echo -e "\n\n3. Testing POST with validation token..."
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"validationToken":"test-123","clientState":"leadify-crm-webhook-secret"}' \
  -v

echo -e "\n\nTest completed."
