import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('msal') || id.includes('@azure')) return 'msal';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('react-dom')) return 'react-dom';
          if (id.includes('react-router')) return 'react-router';
          if (id.includes('node_modules/react/')) return 'react';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    include: ['plyr'],
  },
  server: {
    allowedHosts: [
      'localhost',
      '5338-2a00-a041-f225-300-4d8d-dd49-62d1-2c8d.ngrok-free.app',
      'bafe-2a00-a041-f4a8-1500-9c27-aac5-a96b-e949.ngrok-free.app',
      '2261-2a00-a041-f225-300-54a2-b839-f8b8-e558.ngrok-free.app',
      '69e5-2a00-a041-f225-300-7914-e12f-664-bbfe.ngrok-free.app',
      'fdbca99b1373.ngrok-free.app',
      'backend-eligibility-checker.onrender.com'
    ],
    proxy: {
      '/api': {
        target:  'https://leadify-crm-backend.onrender.com',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
