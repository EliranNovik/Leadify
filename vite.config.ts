import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'localhost',
      'bafe-2a00-a041-f4a8-1500-9c27-aac5-a96b-e949.ngrok-free.app'
    ]
  }
})
