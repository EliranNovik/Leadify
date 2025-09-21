#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting WebSocket server...');

const websocketServer = spawn('node', ['websocket-server.js'], {
  stdio: 'inherit',
  shell: true
});

websocketServer.on('error', (error) => {
  console.error('❌ Failed to start WebSocket server:', error);
});

websocketServer.on('close', (code) => {
  console.log(`📡 WebSocket server exited with code ${code}`);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down WebSocket server...');
  websocketServer.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down WebSocket server...');
  websocketServer.kill('SIGTERM');
  process.exit(0);
});
