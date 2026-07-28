import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      url: path.resolve(rootDir, 'src/lib/nodeUrlShim.ts'),
      'node:url': path.resolve(rootDir, 'src/lib/nodeUrlShim.ts'),
      path: path.resolve(rootDir, 'src/lib/nodePathShim.ts'),
      'node:path': path.resolve(rootDir, 'src/lib/nodePathShim.ts'),
    },
  },
  build: {
    // Avoid one giant vendor chunk — Rollup peak memory spikes on Render (~2GB default heap).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // React core + React bindings must stay together. Isolating packages that
          // call React.createContext / forwardRef / Children into other chunks causes
          // "X of undefined" crashes at runtime (seen with react-dom + recharts).
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules\\react\\') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules\\react-dom') ||
            id.includes('node_modules/scheduler') ||
            id.includes('node_modules\\scheduler') ||
            id.includes('react-router') ||
            id.includes('@azure/msal-react')
          ) {
            return 'react-vendor';
          }

          // Heavy non-React libs only — safe to isolate for build memory / caching.
          if (
            id.includes('@azure/msal-browser') ||
            id.includes('@azure/msal-common')
          ) {
            return 'msal';
          }
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('xlsx')) return 'xlsx';
          if (id.includes('pdfjs')) return 'pdfjs';
          if (id.includes('html2pdf') || id.includes('jspdf')) return 'pdf-export';
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },
  optimizeDeps: {
    include: ['plyr', 'sanitize-html'],
  },
  server: {
    allowedHosts: [
      'localhost',
      '5338-2a00-a041-f225-300-4d8d-dd49-62d1-2c8d.ngrok-free.app',
      'bafe-2a00-a041-f4a8-1500-9c27-aac5-a96b-e949.ngrok-free.app',
      '2261-2a00-a041-f225-300-54a2-b839-f8b8-e558.ngrok-free.app',
      '69e5-2a00-a041-f225-300-7914-e12f-664-bbfe.ngrok-free.app',
      'fdbca99b1373.ngrok-free.app',
      'backend-eligibility-checker.onrender.com',
      '97a7-212-199-32-162.ngrok-free.app',
      'c701-212-199-32-162.ngrok-free.app'
    ],
    proxy: {
      '/api': {
        // Local backend (127.0.0.1 avoids IPv6 ::1 ECONNREFUSED). Default port 3001 matches backend/.env PORT.
        // Override: VITE_API_PROXY_TARGET=http://127.0.0.1:3002 or https://leadify-crm-backend.onrender.com
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  }
})
