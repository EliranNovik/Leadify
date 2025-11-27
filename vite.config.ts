import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  server: {
    allowedHosts: [
      'localhost',
      'bafe-2a00-a041-f4a8-1500-9c27-aac5-a96b-e949.ngrok-free.app',
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
