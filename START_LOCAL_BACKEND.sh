#!/bin/bash
# Quick script to start backend locally for testing

cd backend
echo "🚀 Starting backend on http://localhost:3002"
npm run dev || node server.js

